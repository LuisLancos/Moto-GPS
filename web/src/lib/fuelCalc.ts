/**
 * Fuel estimation utility.
 * Calculates fuel usage, cost, and stop count based on vehicle data and distance.
 */

export interface VehicleFuelData {
  fuel_type: string;            // "petrol" | "diesel" | "ev"
  consumption: number | null;   // raw value
  consumption_unit: string;     // "mpg" | "l100km" | "kwhper100km"
  tank_capacity: number | null; // litres or kWh
  fuel_cost_per_unit: number | null; // cost per litre/kWh
  fuel_cost_currency: string;   // "GBP" | "EUR" | "USD"
}

export interface FuelEstimate {
  fuelUsed: number;        // litres or kWh
  fuelCost: number;        // in vehicle's currency
  fuelStops: number;       // refuelling stops needed
  rangePerTankKm: number;  // km per full tank
  fuelUnit: string;        // "L" or "kWh"
  currencySymbol: string;  // £, €, $
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
};

/**
 * Convert any consumption unit to L/100km (or kWh/100km for EV).
 * Returns null if conversion isn't possible.
 */
function toL100km(consumption: number, unit: string): number | null {
  switch (unit) {
    case "mpg":
      // Imperial MPG → L/100km: 282.481 / mpg
      return consumption > 0 ? 282.481 / consumption : null;
    case "l100km":
      return consumption > 0 ? consumption : null;
    case "kwhper100km":
      return consumption > 0 ? consumption : null; // kWh/100km treated same as L/100km
    default:
      return null;
  }
}

/**
 * Estimate fuel usage, cost, and stops for a given distance.
 * Returns null if vehicle doesn't have enough fuel data.
 */
export function estimateFuel(
  distanceM: number,
  vehicle: VehicleFuelData,
): FuelEstimate | null {
  if (!vehicle.consumption || !vehicle.tank_capacity) return null;

  const consumptionPer100 = toL100km(vehicle.consumption, vehicle.consumption_unit);
  if (!consumptionPer100) return null;

  const distanceKm = distanceM / 1000;

  // Fuel used for this distance
  const fuelUsed = (distanceKm / 100) * consumptionPer100;

  // Cost
  const fuelCost = vehicle.fuel_cost_per_unit
    ? fuelUsed * vehicle.fuel_cost_per_unit
    : 0;

  // Range per tank
  const rangePerTankKm = (vehicle.tank_capacity / consumptionPer100) * 100;

  // Stops needed (don't run tank to empty — assume 90% usable)
  const usableRange = rangePerTankKm * 0.9;
  const fuelStops = usableRange > 0
    ? Math.max(0, Math.ceil(distanceKm / usableRange) - 1)
    : 0;

  const isEV = vehicle.fuel_type === "ev";

  return {
    fuelUsed: Math.round(fuelUsed * 10) / 10,
    fuelCost: Math.round(fuelCost * 100) / 100,
    fuelStops,
    rangePerTankKm: Math.round(rangePerTankKm),
    fuelUnit: isEV ? "kWh" : "L",
    currencySymbol: CURRENCY_SYMBOLS[vehicle.fuel_cost_currency] || vehicle.fuel_cost_currency,
  };
}

/**
 * Format a fuel estimate as a compact string for display.
 */
export function formatFuelEstimate(est: FuelEstimate): string {
  const parts: string[] = [];
  if (est.fuelStops > 0) {
    parts.push(`${est.fuelStops} stop${est.fuelStops > 1 ? "s" : ""}`);
  }
  parts.push(`${est.fuelUsed} ${est.fuelUnit}`);
  if (est.fuelCost > 0) {
    parts.push(`${est.currencySymbol}${est.fuelCost.toFixed(2)}`);
  }
  return parts.join(" · ");
}
