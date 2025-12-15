const fs = require("fs");
const jsonData = fs.readFileSync("./wedoraFirebaseServiceKey.json");
const base64string = Buffer.from(jsonData, "utf-8").toString("base64");
console.log(base64string);
