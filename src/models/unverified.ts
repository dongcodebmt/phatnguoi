
import { Schema, model } from 'mongoose';
import { VehicleType } from '@/enums';
import { IUser } from './user';

export interface IUnverified extends Document {
  id: Schema.Types.ObjectId;
  user: Schema.Types.ObjectId | IUser;
  plateId: string;
  vehicleType: VehicleType;
}

const unverifiedSchema = new Schema<IUnverified>(
  {
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User'
    },
    plateId: {
      type: String,
      required: true,
    },
    vehicleType: {
      type: Number,
      enum: VehicleType,
      required: true,
    },
  },
  { timestamps: true },
);
unverifiedSchema.index({ user: 1, plateId: 1 }, { unique: true });

const Unverified = model<IUnverified>('Unverified', unverifiedSchema);
export default Unverified;