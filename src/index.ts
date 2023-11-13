import { Command } from "commander";
import { getVideoDurationInSeconds } from "get-video-duration";
import crypto from "crypto";
import figlet from "figlet";
import { readFile } from "fs/promises";
import fetch from "node-fetch";
import path from "path";

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
const pathObject = path.parse(inputFilePath);

interface Match {
  episodeId: number;
}

interface MatchingResult {
  success: boolean;
  isMatched: boolean;
  matches: [Match];
}

async function dan2ass() {
  const fileBuffer = await readFile(inputFilePath);
  const fileHash = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const videoDuration = await getVideoDurationInSeconds(inputFilePath);

  const matchingResult = await fetch("https://api.dandanplay.net/api/v2/match", {
    method: "POST",
    body: JSON.stringify({
      fileName: pathObject.name,
      fileHash,
      fileSize: fileBuffer.length,
      videoDuration: Math.floor(videoDuration),
      matchMode: "hashAndFileName",
    }),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!matchingResult.ok) {
    console.error("matchingResult", matchingResult);
    process.exit(1);
  }
  const matchingJson = (await matchingResult.json()) as MatchingResult;
  if (!matchingJson.success) {
    console.error("matchingJson", matchingJson);
    process.exit(1);
  }

  let match = matchingJson.matches[0];
  if (!matchingJson.isMatched) {
    // TODO: show a list of matches and let user choose
    match = matchingJson.matches[0];
  }

  console.log("DONE");
}
dan2ass();
