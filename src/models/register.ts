import { Schema, model } from 'mongoose';
import { IPlate } from './plate';
import { IUser } from './user';

export interface IRegister extends Document {
  id: Schema.Types.ObjectId;
  user: Schema.Types.ObjectId | IUser;
  plate: Schema.Types.ObjectId | IPlate;
  createdAt: Date;
  updatedAt: Date;
}

const registerSchema = new Schema<IRegister>(
  {
    user: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User'
    },
    plate: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Plate'
    }
  },
  { timestamps: true },
);
registerSchema.index({ user: 1, plate: 1 }, { unique: true });

const Register = model<IRegister>('Register', registerSchema);
export default Register;