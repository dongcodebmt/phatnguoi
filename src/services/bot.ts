import { Bot } from 'grammy';
import { Queue } from 'bullmq';
import { BOT_TOKEN } from '@/constants/config';
import { Integraions, commands } from '@/handlers';
import { IUser } from '@/models/user';
import { IViolation } from '@/models/violation';
import { IPlate } from '@/models/plate';
import { vehicleTypes } from '@/constants/consts';
import { States } from '@/constants/consts';

export class BotService {
  private bot = new Bot(BOT_TOKEN);

  constructor(queue: Queue, id: string) {
    this.bot.catch(err => {
      console.error(`Error while handling update ${err.ctx.update.update_id}:`);
      console.error(err.error);
    });

    const integrations = new Integraions(queue, id);
    this.bot.api.setMyCommands(commands);
    this.bot.use(integrations.composer);
  }

  start() {
    this.bot.start({
      drop_pending_updates: true,
      onStart: () => console.log('🚀 Bot started'),
    });
  }

  async sendViolationMessage(user: IUser, violation: IViolation): Promise<void> {
    const plate = violation.plate as IPlate
    const message = `Phát hiện vi phạm mới!\n` +
      `Biển kiểm soát: ${plate.plateNumber}\n` +
      `Màu biển: ${plate.plateColor}\n` +
      `Loại phương tiện: ${vehicleTypes[plate.vehicleType]}\n` +
      `Thời gian vi phạm: ${violation.timeOfViolation.toLocaleString()}\n` +
      `Địa điểm vi phạm: ${violation.locationOfViolation}\n` +
      `Hành vi vi phạm: ${violation.violation}\n` +
      `Đơn vị phát hiện vi phạm: ${violation.unitDetectingViolation}\n` +
      `Nơi giải quyết vụ việc: ${violation.placeOfSettlement}\n` +
      `Trạng thái: ${States[violation.status]}`;

    await this.bot.api.sendMessage(user.userId, message);
  }
}