const fs = require("fs");
const jsonData = fs.readFileSync(
  "./wedora-ae658-firebase-adminsdk-fbsvc-d7c2c1a65d.json"
);
const base64string = Buffer.from(jsonData, "utf-8").toString("base64");
console.log(base64string);
