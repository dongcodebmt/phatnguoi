import { VehicleType, Status } from '@/enums';

export const vehicleTypes = {
  [VehicleType.Unknown]: 'Không xác định ❓',
  [VehicleType.Car]: 'Ô tô 🚗',
  [VehicleType.Motorcycle]: 'Xe máy 🏍️',
  [VehicleType.ElectricBike]: 'Xe đạp điện 🚲'
};

export const States = {
  [Status.NotPunished]: 'Chưa xử phạt',
  [Status.Punished]: 'Đã xử phạt'
};