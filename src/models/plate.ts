
import { Schema, model } from 'mongoose';
import { VehicleType } from '@/enums';

export interface IPlate extends Document {
  id: Schema.Types.ObjectId;
  plateId: string;
  plateNumber?: string;
  plateColor?: string;
  vehicleType: VehicleType;
}

const plateSchema = new Schema<IPlate>(
  {
    plateId: {
      type: String,
      unique: true,
      required: true,
    },
    plateNumber: {
      type: String,
    },
    plateColor: {
      type: String,
    },
    vehicleType: {
      type: Number,
      enum: VehicleType,
      required: true,
    },
  },
  { timestamps: true },
);

const Plate = model<IPlate>('Plate', plateSchema);
export default Plate;