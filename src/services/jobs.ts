import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { CheckerService } from '@/services';
import { REDIS_URI } from '@/constants/config';
import { IUser } from '@/models/user';
import Plate, { IPlate } from '@/models/plate';
import Violation, { IViolation } from '@/models/violation';
import Unverified from '@/models/unverified';
import Register from '@/models/register';
import Notification from '@/models/notification';
import { type IViolationRaw } from '@/models/violation-raw';
import { VehicleType, Status } from '@/enums';
import { States } from '@/constants/consts';
import { BotService } from '@/services';

export class JobsService {
  private connection: Redis;
  private schedulerQueue: Queue;
  private verifiedQueue: Queue;
  private unverifiedQueue: Queue;
  private checker = new CheckerService();
  private bot: BotService;
  private readonly schedulerQueueId: string = 'setup-daily-scheduler';
  private readonly verifiedQueueId: string = 'verified-plate-crawl';
  private readonly unverifiedQueueId: string = 'unverified-plate-crawl';
  private readonly schedulerId: string = 'daily-scheduler';
  private readonly limiter = {
    max: 1,
    duration: 60 * 1000, // 1 request per 1 minutes
  };
  private readonly queueOpts = {
    attempts: 60 * 24,
    backoff: {
      type: 'fixed',
      delay: 60 * 1000,
    },
  };

  constructor() {
    this.connection = new Redis(REDIS_URI, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.schedulerQueue = new Queue(this.schedulerQueueId, { connection: this.connection });
    this.verifiedQueue = new Queue(this.verifiedQueueId, { connection: this.connection });
    this.unverifiedQueue = new Queue(this.unverifiedQueueId, { connection: this.connection });
    this.bot = new BotService(this.unverifiedQueue, this.unverifiedQueueId);
    this.init();
  }

  public async upsertDailyScheduler(): Promise<void> {
    await this.schedulerQueue.upsertJobScheduler(
      this.schedulerId,
      {
        every: 24 * 60 * 60 * 1000, // every 24 hours
      },
      {
        name: this.schedulerId
      }
    );

    console.log('[SCHEDULER] ⏰ Upserted daily job scheduler');
  }

  private init(): void {
    this.bot.start();
    this.setupShedulerJob();
    this.setupWorkers();
  }

  private setupShedulerJob(): void {
    const schedulerWorker = new Worker(
      this.schedulerQueueId,
      async (job) => {
        const plates = await Plate.find({});

        for (const plate of plates) {
          await this.verifiedQueue.add(this.verifiedQueueId, plate, this.queueOpts);
        }

        const unverifieds = await Unverified.find({});
        for (const unverified of unverifieds) {
          await this.unverifiedQueue.add(this.unverifiedQueueId, unverified, this.queueOpts);
        }

        console.log(`[SCHEDULER] ✅ Enqueued ${plates.length + unverifieds.length} plates`);
      },
      { connection: this.connection }
    );
    schedulerWorker.on('completed', (job) => {
      console.log(`[SCHEDULER] ✅ Job ${job.id} completed`);
    });
    schedulerWorker.on('failed', (job, err) => {
      console.error(`[SCHEDULER] ❌ Job ${job?.id} failed:`, err);
    });
  }

  private setupWorkers(): void {
    const verifiedWorker = new Worker(
      this.verifiedQueueId,
      async (job) => {
        const { plateId, vehicleType } = job.data;

        const violations = await this.saveCrawlData(plateId, vehicleType);
        if (violations.length === 0) {
          return;
        }
        
        for (const violation of violations) {
          await this.sendNotification(violation);
        }
        console.log(`[WORKER] Done ${plateId}`);
      },
      {
        connection: this.connection,
        limiter: this.limiter
      }
    );
    verifiedWorker.on('completed', (job) => {
      console.log(`[WORKER] ✅ Job ${job.id} completed`);
    });
    verifiedWorker.on('failed', (job, err) => {
      console.error(`[WORKER] ❌ Job ${job?.id} failed:`, err);
    });


    const unverifiedWorker = new Worker(
      this.unverifiedQueueId,
      async (job) => {
        const { plateId, vehicleType } = job.data;
        const violations = await this.saveCrawlData(plateId, vehicleType);
        if (violations.length === 0) {
          return;
        }

        const plate = await Plate.findOne({ plateId });
        const unverifieds = await Unverified.find({ plateId }).populate('user');
        for (const unverified of unverifieds) {
          let register = await Register.findOne({ user: unverified.user, plate: plate });

          if (!register) {
            register = await new Register({
              user: unverified.user,
              plate: plate,
            }).save();
          }
          await unverified.deleteOne().exec();
        }

        
        for (const violation of violations) {
          await this.sendNotification(violation);
        }
        console.log(`[WORKER] Done ${plateId}`);
      },
      {
        connection: this.connection,
        limiter: this.limiter
      }
    );
    unverifiedWorker.on('completed', (job) => {
      console.log(`[WORKER] ✅ Job ${job.id} completed`);
    });
    unverifiedWorker.on('failed', (job, err) => {
      console.error(`[WORKER] ❌ Job ${job?.id} failed:`, err);
    });
  }

  private async saveCrawlData(plateId: string, vehicleType: VehicleType): Promise<IViolation[]> {
    const list: IViolation[] = [];
    const violationRaws = await this.checker.getDataAsync(plateId, vehicleType);
    if (violationRaws.length > 0) {
      const plate = await this.savePlate(plateId, vehicleType, violationRaws[0]);
      for (const violationRaw of violationRaws) {
        const violation = await this.saveViolation(plate, violationRaw);
        list.push(violation);
      }
    }
    return list;
  }

  // private async getUnnotifiedViolations(user: IUser): Promise<IViolation[]> {
  //   const notified = await Notification.find({ user }).distinct('violation');
  //   const unnotifiedViolations = await Violation.find({
  //     _id: { $nin: notified }
  //   }).populate('plate');
  //   return unnotifiedViolations;
  // }

  // private async sendNotification(plate: IPlate): Promise<void> {
  //   const registers = await Register.find({ plate: plate }).populate('user');
  //   for (const register of registers) {
  //     const user = register.user as IUser;
  //     const violations = await this.getUnnotifiedViolations(user);

  //     for (const violation of violations) {
  //       await new Notification({
  //         user: user,
  //         violation: violation
  //       }).save();

  //       this.bot.sendViolationMessage(user, violation);
  //     }
  //   }
  // }

  private async sendNotification(violation: IViolation): Promise<void> {
    const registers = await Register.find({ plate: violation.plate }).populate('user');
    for (const register of registers) {
      const user = register.user as IUser;

      const notification = await Notification.findOne({ user: user, violation: violation });
      if (!notification) {
        await new Notification({
          user: user,
          violation: violation
        }).save();

        await this.bot.sendViolationMessage(user, violation);
      }
    }
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
    const status = data.status.toLowerCase() === States[Status.Punished].toLowerCase() ? Status.Punished : Status.NotPunished;
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
