export const uploadDataTypes = {
  "Image Data": {
    fields: [
      "experiment",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: "image/*",
  },
  "Platform Logs": {
    fields: ["experiment", "location", "population", "date", "platform"],
    fileType: "*",
  },
  "Farm-ng Binary File": {
    fields: ["experiment", "location", "population", "date"],
    fileType: "*",
  },
  Orthomosaic: {
    fields: [
      "experiment",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".tif",
  },
  "Weather Data": {
    fields: ["experiment", "location", "population", "date"],
    fileType: "*",
  },
};
