// Travel modes and the defaults used before we know how fast the user is.

export const MODES = {
  walk: {
    id: "walk",
    label: "Walk",
    icon: "🚶",
    defaultSpeedKmh: 4.8,
    routingProfile: "foot",
    arriveRadius: 40,
  },
  bike: {
    id: "bike",
    label: "Bike",
    icon: "🚲",
    defaultSpeedKmh: 15,
    routingProfile: "bike",
    arriveRadius: 60,
  },
  moto: {
    id: "moto",
    label: "Motorcycle",
    icon: "🏍️",
    defaultSpeedKmh: 45,
    routingProfile: "car",
    arriveRadius: 120,
  },
  car: {
    id: "car",
    label: "Car",
    icon: "🚗",
    defaultSpeedKmh: 40,
    routingProfile: "car",
    arriveRadius: 150,
  },
};

export const MODE_IDS = Object.keys(MODES);
