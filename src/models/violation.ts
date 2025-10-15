import { Schema, model } from 'mongoose';
import { IPlate } from './plate';
import { Status } from '@/enums';

export interface IViolation extends Document {
  id: Schema.Types.ObjectId;
  plate: Schema.Types.ObjectId | IPlate;
  timeOfViolation: Date;
  locationOfViolation: string;
  violation: string;
  status: Status;
  unitDetectingViolation: string;
  placeOfSettlement: string;
  createdAt: Date;
  updatedAt: Date;
}

const violationSchema = new Schema<IViolation>(
  {
    plate: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Plate'
    },
    timeOfViolation: {
      type: Date,
      required: true
    },
    locationOfViolation: {
      type: String,
    },
    violation: {
      type: String,
    },
    status: {
      type: Number,
      enum: Status,
    },
    unitDetectingViolation: {
      type: String,
    },
    placeOfSettlement: {
      type: String,
    }
  },
  { timestamps: true },
);
violationSchema.index({ plate: 1, timeOfViolation: 1 }, { unique: true });

const Violation = model<IViolation>('Violation', violationSchema);
export default Violation;