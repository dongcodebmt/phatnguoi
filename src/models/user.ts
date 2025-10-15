import { Schema, model } from 'mongoose';

export interface IUser extends Document {
  id: Schema.Types.ObjectId;
  userId: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    userId: {
      type: Number,
      unique: true,
      required: true,
    }
  },
  { timestamps: true },
);

const User = model<IUser>('User', userSchema);
export default User;