import { Command } from "commander";
import figlet from "figlet";
import fetch from "node-fetch";

console.log(figlet.textSync("dan²ass"));

const program = new Command();
program
  .version("1.0.0")
  .description("A CLI for searching dandanplay danmaku and generating the .ass file")
  .option("--font-size <value>", "font size")
  .argument("<input-file>")
  .parse(process.argv);
const options = program.opts();
const inputFilePath = program.args[0];

(async () => {
  const result = await fetch("https://api.dandanplay.net/api/v2/match", {
    method: "POST",
    body: JSON.stringify({
      fileName: inputFilePath,
      fileHash: "0000",
      fileSize: 0,
      videoDuration: 0,
      matchMode: "hashAndFileName",
    }),
  });

  console.log("DONE");
})();
