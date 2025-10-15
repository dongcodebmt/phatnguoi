import { Schema, model } from 'mongoose';
import { IViolation } from './violation';
import { IUser } from './user';

export interface INotification extends Document {
  id: Schema.Types.ObjectId;
  user: Schema.Types.ObjectId | IUser;
  violation: Schema.Types.ObjectId | IViolation;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User'
    },
    violation: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Violation'
    }
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, violation: 1 }, { unique: true });

const Notification = model<INotification>('Notification', notificationSchema);
export default Notification;