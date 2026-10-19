export * from './vehicles.module';
export * from './vehicles.service';
export * from './dto/create-vehicle.dto';
export * from './dto/update-vehicle.dto';
export * from './dto/query-vehicle.dto';
export * from './entities/vehicle.entity';
// The cost per kilometre, for US14 to price a trip at full precision.
export {
  COST_PER_KM_DECIMAL_PLACES,
  costPerKm,
  formatCostPerKm,
} from './domain/vehicle-cost';
