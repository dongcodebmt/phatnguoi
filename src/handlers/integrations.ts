import { Composer, InlineKeyboard, Context } from 'grammy';
import { Queue } from 'bullmq';
import User, { IUser } from '@/models/user';
import Plate, { IPlate } from '@/models/plate';
import Violatio, { IViolation } from '@/models/violation';
import Register from '@/models/register';
import Unverified from '@/models/unverified';
import { VehicleType } from '@/enums';
import { vehicleTypes } from '@/constants/consts';
import commands from './commands';
import { buildViolationMessage } from '@/utils';

export class Integraions {
  private queue: Queue;
  private queueId: string;
  public composer = new Composer();
  private readonly queueOpts = {
    attempts: 100,
    backoff: {
      type: 'fixed',
      delay: 5 * 60 * 1000,
    },
  };

  constructor(queue: Queue, id: string) {
    this.queue = queue;
    this.queueId = id;
    this.composer.command('start', async ctx => {
      const userId = ctx.from?.id;
      if (!userId) return;

      await this.user(userId);
      let message = `Chào bạn 👋\nCác lệnh hỗ trợ:\n`;
      for (const cmd of commands) {
        message += `- /${cmd.command} ${cmd.description}\n`;
      }
      await ctx.reply(message);
    });

    this.composer.command('add', async (ctx) => {
      await ctx.reply('Nhập biển số xe bạn muốn thêm:');

      const handler = async (msgCtx: Context) => {
        if (msgCtx.from?.id !== ctx.from?.id) return;

        const plate = msgCtx.message?.text?.trim();
        if (!plate) {
          await msgCtx.reply('❌ Biển số không hợp lệ.');
          return;
        }

        const keyboard = new InlineKeyboard()
          .text(vehicleTypes[VehicleType.Car], `vehicle_${VehicleType.Car}_${plate}`).row()
          .text(vehicleTypes[VehicleType.Motorcycle], `vehicle_${VehicleType.Motorcycle}_${plate}`).row()
          .text(vehicleTypes[VehicleType.ElectricBike], `vehicle_${VehicleType.ElectricBike}_${plate}`);

        await msgCtx.reply('Chọn loại xe:', { reply_markup: keyboard });
      };

      this.composer.on('message:text', handler);
    });

    this.composer.command('list', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const user = await this.user(userId);
      const plates = await this.getPlates(user);

      if (plates.length === 0) {
        await ctx.reply('🚫 Bạn chưa có biển số nào');
        return;
      }

      const list = plates
        .map((item, i) => {
          return `${i + 1}. ${item.plateNumber} (${vehicleTypes[item.vehicleType]})`;
        }
        )
        .join('\n');

      await ctx.reply(`📜 Danh sách biển số:\n${list}`);
    });


    this.composer.command('delete', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const user = await this.user(userId);
      const plates = await this.getPlates(user);

      if (plates.length === 0) {
        await ctx.reply('🚫 Không có biển số nào để xóa');
        return;
      }

      const keyboard = new InlineKeyboard();
      plates.forEach(item => {
        keyboard.text(`${item.plateNumber} (${vehicleTypes[item.vehicleType]})`, `delete_${item.id}`).row();
      });

      await ctx.reply('Chọn biển số để xóa:', { reply_markup: keyboard });
    });

    
    this.composer.command('check', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const user = await this.user(userId);
      const plates = await this.getPlates(user);

      if (plates.length === 0) {
        await ctx.reply('🚫 Không có biển số nào để kiểm tra vi phạm');
        return;
      }

      const keyboard = new InlineKeyboard();
      plates.forEach(item => {
        keyboard.text(`${item.plateNumber} (${vehicleTypes[item.vehicleType]})`, `check_${item.id}`).row();
      });

      await ctx.reply('Chọn biển số để kiểm tra vi phạm:', { reply_markup: keyboard });
    });


    this.composer.callbackQuery(/^vehicle_(\d+)_(.+)$$/, async (ctx) => {
      const type = ctx.match![1] as unknown as VehicleType;
      const plateId = ctx.match![2].toUpperCase().replaceAll(' ','').replaceAll('.','').replaceAll('-','');
      const userId = ctx.from?.id;

      if (!userId || !plateId || !type) return;
      const user = await this.user(userId);

      if (!this.validatePlate(plateId, type)) {
        await ctx.reply('🚫 Biển số không hợp lệ');
        return;
      }

      // Biển số đã xác nhận thì đăng ký cho user luôn
      const plate = await Plate.findOne({ plateId: plateId });
      if (plate) {
        let register = await Register.findOne({ user, plate });
        if (register) {
          await ctx.reply('🚫 Bạn đã thêm biển số này');
          return;
        }

        register = await new Register({
          user: user,
          plate: plate,
        }).save();
      } else { // Biển số chưa xác nhận
        let unverified = await Unverified.findOne({ user, plateId: plateId });
        if (unverified) {
          await ctx.reply('🚫 Bạn đã thêm biển số này');
          return;
        }

        unverified = await new Unverified({
          user,
          plateId: plateId,
          vehicleType: type,
        }).save();

        // Add to queue
        await this.queue.add(this.queueId, unverified, this.queueOpts);
      }

      await ctx.answerCallbackQuery();
      await ctx.reply(
        `✅ Đã thêm biển số: ${plateId} (${vehicleTypes[type]})`
      );
    });

    this.composer.callbackQuery(/^delete_(\w+)$/, async (ctx) => {
      const id = ctx.match![1];
      const userId = ctx.from?.id;
      if (!userId || !id) return;

      const user = await this.user(userId);
      const result = await this.deletePlate(user, id);

      if (result) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `🗑️ Đã xóa: ${result.plateNumber} (${vehicleTypes[result.vehicleType]})`
        );
      } else {
        await ctx.answerCallbackQuery({ text: '❌ Không tìm thấy biển số này', show_alert: true });
      }
    });

    this.composer.callbackQuery(/^check_(\w+)$/, async (ctx) => {
      const id = ctx.match![1];
      const userId = ctx.from?.id;
      if (!userId || !id) return;

      const unverified = await Unverified.findById(id);
      if (unverified) {
        await ctx.answerCallbackQuery();
        await ctx.reply(`✅ Biển số ${unverified.plateId} không có vi phạm)`);
      }
      const plate = await Plate.findById(id);
      if (!plate) {
        await ctx.answerCallbackQuery({ text: '❌ Không tìm thấy biển số', show_alert: true });
      }
      const violations = await Violatio.find({ plate }).sort({ timeOfViolation: -1 }).populate('plate');
      if (violations.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.reply(`✅ Biển số ${plate?.plateNumber} không có vi phạm)`);
      }

      await ctx.answerCallbackQuery();
      for (const violation of violations) {
        await ctx.reply(buildViolationMessage(violation, false));
      }
    });
  }

  private async user(userId: number): Promise<IUser> {
    let user = await User.findOne({
      userId: userId,
    });

    if (!user) {
      user = await new User({ userId }).save();
    }
    return user;
  }

  private async getPlates(user: IUser): Promise<IPlate[]> {
    const registers = await Register.find({ user }).populate('plate');
    const unverifieds = await Unverified.find({ user });

    const plates: IPlate[] = [];
    for (const register of registers) {
      plates.push(register.plate as IPlate);
    }
    for (const unverified of unverifieds) {
      plates.push({
        id: unverified.id,
        plateId: unverified.plateId,
        plateNumber: unverified.plateId,
        vehicleType: unverified.vehicleType,
      } as IPlate);
    }
    return plates;
  }

  private async deletePlate(user: IUser, id: string): Promise<IPlate | undefined> {
    let plate: IPlate | undefined = undefined;
    const register = await Register.findOne({ user, plate: id }).populate('plate');
    if (register) {
      plate = register.plate as IPlate;
      await register.deleteOne().exec();
    }
    const unverified = await Unverified.findById(id);
    if (unverified) {
      plate = {
        plateId: unverified.plateId,
        plateNumber: unverified.plateId,
        vehicleType: unverified.vehicleType,
      } as IPlate;
      await unverified.deleteOne().exec();
    }
    return plate;
  }

  private validatePlate(plateNumber: string, vehicleType: VehicleType): boolean {
    const patterns = {
      [VehicleType.Car]: /^[0-9]{2}[A-Z]{1}[0-9]{4,5}$/,          // Ô tô: 2 số + 1 chữ cái + 4–5 số
      [VehicleType.Motorcycle]: /^[0-9]{2}[A-Z]{1}[0-9]{5,6}$/,   // Xe máy: 2 số + 1 chữ cái + 5–6 số
      [VehicleType.ElectricBike]: /^[0-9]{2}[A-Z]{2}[0-9]{5,6}$/  // Xe đạp điện: 2 số + 2 chữ cái + 5–6 số
    };
    const pattern = patterns[vehicleType];
    return pattern.test(plateNumber);
  }
}