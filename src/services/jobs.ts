import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { CheckerService } from '@/services';
import { REDIS_URI } from '@/constants/config';
import { IUser } from '@/models/user';
import Plate, { IPlate } from '@/models/plate';
import Violation, { IViolation } from '@/models/violation';
import Notification, { INotification } from '@/models/notification';
import Unverified from '@/models/unverified';
import Register from '@/models/register';
import { type IViolationRaw } from '@/models/violation-raw';
import { VehicleType, Status } from '@/enums';
import { States } from '@/constants/consts';
import { BotService } from '@/services';

export class JobsService {
  private connection: Redis;

  // Queues
  private schedulerQueue: Queue;
  private verifiedQueue: Queue;
  private unverifiedQueue: Queue;
  private sendNotifyQueue: Queue;
  private scanNotifyQueue: Queue;

  private checker = new CheckerService();
  private bot: BotService;

  private readonly schedulerQueueId = 'daily-scheduler-setup';
  private readonly verifiedQueueId = 'verified-plate-queue';
  private readonly unverifiedQueueId = 'unverified-plate-queue';
  private readonly sendNotifyQueueId = 'send-notify-queue';
  private readonly scanNotifyQueueId = 'scan-notify-queue';

  private readonly limiter = {
    max: 1,
    duration: 60 * 1000, // 1 request per 1 minute
  };
  private readonly queueOpts = {
    attempts: 60 * 24,
    backoff: {
      type: 'fixed' as const,
      delay: 60 * 1000,
    },
  };

  constructor() {
    this.connection = new Redis(REDIS_URI, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.schedulerQueue = this.createQueue(this.schedulerQueueId);
    this.verifiedQueue = this.createQueue(this.verifiedQueueId);
    this.unverifiedQueue = this.createQueue(this.unverifiedQueueId);
    this.sendNotifyQueue = this.createQueue(this.sendNotifyQueueId);
    this.scanNotifyQueue = this.createQueue(this.scanNotifyQueueId);

    this.bot = new BotService(this.unverifiedQueue, this.unverifiedQueueId);
  }

  init(): void {
    this.bot.start();
    this.setupWorkers();
    this.setupNotificationWorker();
    // start async schedulers, log errors
    this.setupDailySchedulerJob().catch((err) => console.error('Daily scheduler failed to init', err));
    this.setupNotifyScanner().catch((err) => console.error('Notify scanner failed to init', err));
    console.log('🚀 Jobs initiated');
  }

  // helper to create a queue bound to the service redis connection
  private createQueue(name: string): Queue {
    return new Queue(name, { connection: this.connection });
  }

  // helper to create Worker and attach common error handler
  private createWorker(queueId: string, processor: (job: any) => Promise<any>, opts: any = {}): Worker {
    const worker = new Worker(queueId, processor, { connection: this.connection, ...opts });
    worker.on('failed', (job, err) => {
      console.error(`[WORKER:${queueId}] ❌ Job ${job?.id} failed:`, err);
    });
    return worker;
  }

  private async setupDailySchedulerJob(): Promise<void> {
    const id = 'daily-scheduler';
    await this.schedulerQueue.upsertJobScheduler(
      id,
      { every: 24 * 60 * 60 * 1000 },
      { name: id }
    );

    this.createWorker(
      this.schedulerQueueId,
      async () => {
        const plates = await Plate.find({});
        for (const plate of plates) {
          await this.verifiedQueue.add(this.verifiedQueueId, plate, this.queueOpts);
        }

        const unverifieds = await Unverified.find({});
        for (const unverified of unverifieds) {
          await this.unverifiedQueue.add(this.unverifiedQueueId, unverified, this.queueOpts);
        }
      }
    );
  }

  private setupWorkers(): void {
    // verified plates
    this.createWorker(
      this.verifiedQueueId,
      async (job) => {
        const { plateId, vehicleType } = job.data;
        const violations = await this.getViolationFromCSGT(plateId, vehicleType);
        if (!violations.length) return;
        for (const violation of violations) {
          await this.sendNotificationToRegisters(violation);
        }
      },
      { limiter: this.limiter }
    );

    // unverified plates
    this.createWorker(
      this.unverifiedQueueId,
      async (job) => {
        const { plateId, vehicleType } = job.data;
        const violations = await this.getViolationFromCSGT(plateId, vehicleType);
        if (!violations.length) return;

        const plate = await Plate.findOne({ plateId });
        const unverifieds = await Unverified.find({ plateId }).populate('user');
        for (const unverified of unverifieds) {
          let register = await Register.findOne({ user: unverified.user, plate: plate });
          if (!register) {
            register = await new Register({ user: unverified.user, plate: plate }).save();
          }
          await unverified.deleteOne().exec();
        }

        for (const violation of violations) {
          await this.sendNotificationToRegisters(violation);
        }
      },
      { limiter: this.limiter }
    );
  }

  private setupNotificationWorker(): void {
    this.createWorker(
      this.sendNotifyQueueId,
      async (job) => {
        const { user, violation } = job.data as { user: IUser; violation: IViolation };
        await this.sendNotification(user, violation);
      }
    );
  }

  private async setupNotifyScanner(): Promise<void> {
    const id = 'scan-notify-scheduler';
    await this.scanNotifyQueue.upsertJobScheduler(id, { every: 60 * 1000 }, { name: id });

    this.createWorker(
      this.scanNotifyQueueId,
      async () => {
        const days = 1;
        const now = new Date();
        const condition = new Date();
        condition.setDate(now.getDate() - days);

        const violations = await Violation.find({ createdAt: { $gte: condition } }).populate('plate');
        for (const violation of violations) {
          const plate = violation.plate as IPlate;
          const registers = await Register.find({ plate: plate }).populate('user');
          for (const register of registers) {
            const user = register.user as IUser;
            await this.sendNotifyQueue.add(this.sendNotifyQueueId, { user, violation }, this.queueOpts);
          }
        }
      }
    );
  }

  private async sendNotificationToRegisters(violation: IViolation): Promise<void> {
    const plate = violation.plate as IPlate;
    const registers = await Register.find({ plate: plate }).populate('user');
    for (const register of registers) {
      const user = register.user as IUser;
      await this.sendNotifyQueue.add(this.sendNotifyQueueId, { user, violation }, this.queueOpts);
    }
  }

  private async sendNotification(user: IUser, violation: IViolation): Promise<INotification> {
    let notification = await Notification.findOne({ user: user, violation: violation });
    if (!notification) {
      notification = await new Notification({ user: user, violation: violation }).save();
      await this.bot.sendViolationMessage(user, violation);
    }
    return notification;
  }

  private async getViolationFromCSGT(plateId: string, vehicleType: VehicleType): Promise<IViolation[]> {
    const list: IViolation[] = [];
    const violationRaws = await this.checker.getDataAsync(plateId, vehicleType);
    if (violationRaws.length > 0) {
      const plate = await this.savePlate(plateId, vehicleType, violationRaws[0]);
      for (const violationRaw of violationRaws) {
        // Save violation to our DB
        const violation = await this.saveViolation(plate, violationRaw);
        list.push(violation);
      }
    }
    return list;
  }

  private async savePlate(plateId: string, vehicleType: VehicleType, data: IViolationRaw): Promise<IPlate> {
    let plate = await Plate.findOne({ plateId });
    if (plate) {
      if (plate.plateColor !== data.plateColor) {
        plate.plateColor = data.plateColor;
        await plate.save();
      }
    } else {
      plate = await new Plate({
        plateId,
        plateNumber: data.plateNumber,
        plateColor: data.plateColor,
        vehicleType
      }).save();
    }
    return plate;
  }

  private async saveViolation(plate: IPlate, data: IViolationRaw): Promise<IViolation> {
    const status =
      data.status.toLowerCase() === States[Status.Punished].toLowerCase()
        ? Status.Punished
        : Status.NotPunished;

    let violation = await Violation.findOne({ plate: plate, timeOfViolation: data.timeOfViolation });

    if (violation) {
      if (violation.status !== status) {
        violation.status = status;
        await violation.save();
      }
    } else {
      violation = await new Violation({
        plate: plate,
        timeOfViolation: data.timeOfViolation,
        locationOfViolation: data.locationOfViolation,
        violation: data.violation,
        status: status,
        unitDetectingViolation: data.unitDetectingViolation,
        placeOfSettlement: data.placeOfSettlement
      }).save();
    }
    violation.plate = plate;
    return violation;
  }
}
