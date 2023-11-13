import { Command } from "commander";
import crypto from "crypto";
import figlet from "figlet";
import { readFile } from "fs/promises";
import { getVideoDurationInSeconds } from "get-video-duration";
import fetch from "node-fetch";
import path from "path";
import prompts from "prompts";

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
  animeTitle: string;
  episodeTitle: string;
}

interface MatchingResult {
  success: boolean;
  isMatched: boolean;
  matches: [Match];
}

interface Comment {
  cid: number;
  /** 出现时间,模式,颜色,用户ID */
  p: string;
  m: string;
}

interface Comments {
  count: number;
  comments: [Comment];
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

  let episodeId = matchingJson.matches[0]?.episodeId;
  if (!matchingJson.isMatched) {
    const response = await prompts([
      {
        name: "episodeId",
        type: "select",
        message: "请选择匹配的集数",
        choices: matchingJson.matches.map((m) => ({
          title: `${m.animeTitle} -- ${m.episodeTitle}`,
          value: m.episodeId,
        })),
      },
    ]);
    console.log("selection:", response);
    episodeId = response.episodeId;
  }
  if (!episodeId) {
    process.exit(0);
  }

  const commentsResult = await fetch(
    `https://api.dandanplay.net/api/v2/comment/${episodeId}?withRelated=true`,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  if (!commentsResult.ok) {
    console.error("commentsResult", commentsResult);
    process.exit(1);
  }
  const commentsJson = (await commentsResult.json()) as Comments;
  if (!commentsJson.count) {
    console.error("commentsJson", commentsJson);
    process.exit(1);
  }
  console.log("commentsJson", commentsJson);

  console.log("DONE");
}
dan2ass();
