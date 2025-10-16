import { Bot } from 'grammy';
import { Queue } from 'bullmq';
import { BOT_TOKEN } from '@/constants/config';
import { Integraions, commands } from '@/handlers';
import { IUser } from '@/models/user';
import { IViolation } from '@/models/violation';
import { buildViolationMessage } from "@/utils";

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
    await this.bot.api.sendMessage(user.userId, buildViolationMessage(violation, true));
  }
}