import { exec } from "child_process";
import { Command, Option } from "commander";
import crypto from "crypto";
import figlet from "figlet";
import { open } from "fs/promises";
import { getVideoDurationInSeconds } from "get-video-duration";
import fetch from "node-fetch";
import path from "path";
import prompts from "prompts";
import untildify from "untildify";

console.log(figlet.textSync("dan²ass"));

const program = new Command();
program
  .version("1.0.0")
  .description("A CLI for searching dandanplay danmaku and generating the .ass file")
  .option("--debug", "debugging")
  .addOption(new Option("--play-res-x", "").default(1920))
  .addOption(new Option("--play-res-y", "").default(1080))
  .addOption(new Option("--bottom-space", "").default(200))
  .addOption(new Option("--scroll-time", "").default(16))
  .addOption(new Option("--fix-time", "").default(7))
  .addOption(new Option("--font-name", "").default("Twitter Color Emoji"))
  .addOption(new Option("--font-size", "").default(32))
  .addOption(new Option("--opacity", "").default(0.6))
  .addOption(new Option("--outline", "").default(1))
  .addOption(new Option("--shadow", "").default(1))
  .option("--font-size <value>", "font size")
  .argument("<input-file>")
  .parse(process.argv);
const options = program.opts();

const inputFilePath = path.resolve(untildify(program.args[0]));
const pathObject = path.parse(inputFilePath);

interface Match {
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
}

interface MatchingResult {
  success: boolean;
  isMatched: boolean;
  matches: Match[];
}

enum DanmakuMode {
  NORMAL = 1,
  TOP = 5,
  BOTTOM = 4,
}

interface Danmaku {
  cid: number;
  /** 出现时间,模式,颜色,用户ID */
  p: string;
  m: string;

  time: number;
  mode: DanmakuMode;
  color: Color;
  userId: string;
  text: string;

  top: number;
  start: number;
  end: number;
  left: number;
}

interface CommentsResult {
  count: number;
  comments: Danmaku[];
}

async function dan2ass() {
  let danmakuList = await loadDanmakuList();
  danmakuList = layoutDanmaku(danmakuList);

  const outputFileContent = generateAssContent(danmakuList);
  const outputFileHandle = await open(path.join(pathObject.dir, `${pathObject.name}.ass`), "w");
  await outputFileHandle.write(outputFileContent);
  outputFileHandle.close();

  await new Promise((resolve) => setTimeout(resolve, 200));
  openFileWithDefaultApp(inputFilePath);
  console.log("DONE");
}
dan2ass();

async function loadDanmakuList(): Promise<Danmaku[]> {
  const fileHandle = await open(inputFilePath, "r");
  const fileHashRange = 16 * 1024 * 1024;
  const fileBuffer = Buffer.alloc(fileHashRange);
  await fileHandle.read(fileBuffer, 0, fileHashRange, 0);
  const fileHash = crypto.createHash("md5").update(fileBuffer).digest("hex");

  const fileSize = (await fileHandle.stat()).size;
  const videoDuration = await getVideoDurationInSeconds(inputFilePath);

  fileHandle.close();

  const matchingResult = await fetch("https://api.dandanplay.net/api/v2/match", {
    method: "POST",
    body: JSON.stringify({
      fileName: pathObject.name,
      fileHash,
      fileSize,
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
  if (!options.debug && !matchingJson.isMatched) {
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
    episodeId = response.episodeId;
  } else {
    console.log("匹配到的集数", matchingJson.matches[0]);
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
  const commentsJson = (await commentsResult.json()) as CommentsResult;
  if (!Number.isFinite(commentsJson.count)) {
    console.error("commentsJson", commentsJson);
    process.exit(1);
  }

  commentsJson.comments.forEach((c) => {
    c.time = parseFloat(c.p.split(",")[0]);
    c.mode = parseInt(c.p.split(",")[1]);
    const color = parseInt(c.p.split(",")[2]);
    c.color = { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
    c.userId = c.p.split(",")[3];
    c.text = c.m;
  });
  return commentsJson.comments;
}

function layoutDanmaku(danmakuList: Danmaku[]): Danmaku[] {
  const layout = initializeLayout();
  const sortedList = danmakuList.slice().sort((x, y) => x.time - y.time);
  return sortedList.map(layout).filter((danmaku) => !!danmaku) as Danmaku[];
}

function initializeLayout() {
  let { playResX, playResY, fontName, fontSize, bold, padding, scrollTime, fixTime, bottomSpace } =
    options;
  let [paddingTop, paddingRight, paddingBottom, paddingLeft] = padding || [0, 0, 0, 0];

  let defaultFontSize = fontSize; // fontSize[FontSize.NORMAL];
  let grids = splitGrids();
  let gridHeight = paddingTop + defaultFontSize + paddingBottom;

  return (danmaku: Danmaku): Danmaku | null => {
    let targetGrids = grids[danmaku.mode];
    let danmakuFontSize = fontSize; // fontSize[danmaku.fontSizeType];
    let rectWidth =
      paddingLeft +
      // measureTextWidth(fontName, danmakuFontSize, bold, danmaku.content) +
      fontSize * danmaku.text.length +
      paddingRight;
    let verticalOffset = paddingTop + Math.round((defaultFontSize - danmakuFontSize) / 2);

    let gridNumber = -1;
    for (let i = 0; i < 42; i++) {
      const delta = i * 0.2;
      const gn =
        danmaku.mode === DanmakuMode.NORMAL
          ? resolveAvailableScrollGrid(
              grids[danmaku.mode],
              rectWidth,
              playResX,
              danmaku.time + delta,
              scrollTime,
            )
          : resolveAvailableFixGrid(grids[danmaku.mode], danmaku.time + delta);
      if (gn >= 0) {
        gridNumber = gn;
        break;
      }
    }
    if (gridNumber < 0) {
      console.warn(`[Warn] Collision ${danmaku.time}: ${danmaku.text}`);
      return null;
    }

    switch (danmaku.mode) {
      case DanmakuMode.NORMAL: {
        targetGrids[gridNumber] = {
          width: rectWidth,
          start: danmaku.time,
          end: danmaku.time + scrollTime,
        };

        let top = gridNumber * gridHeight + verticalOffset;
        let start = playResX + paddingLeft;
        let end = -rectWidth;

        return { ...danmaku, top, start, end };
      }

      case DanmakuMode.TOP: {
        targetGrids[gridNumber] = danmaku.time + fixTime;

        let top = gridNumber * gridHeight + verticalOffset;
        // 固定弹幕横向按中心点计算
        let left = Math.round(playResX / 2);

        return { ...danmaku, top, left };
      }

      case DanmakuMode.BOTTOM: {
        targetGrids[gridNumber] = danmaku.time + fixTime;

        // 底部字幕的格子是留出`bottomSpace`的位置后从下往上算的
        let top = playResY - bottomSpace - gridHeight * gridNumber - gridHeight + verticalOffset;
        let left = Math.round(playResX / 2);

        return { ...danmaku, top, left };
      }
    }
  };
}

interface NormalGrid {
  width: number;
  start: number;
  end: number;
}
interface Grids {
  [DanmakuMode.NORMAL]: NormalGrid[];
  [DanmakuMode.TOP]: number[];
  [DanmakuMode.BOTTOM]: number[];
}

function splitGrids(): Grids {
  const { padding, playResY, bottomSpace, fontSize } = options;
  let defaultFontSize = fontSize; // fontSize[FontSize.NORMAL];
  let paddingTop = padding?.[0] || 0;
  let paddingBottom = padding?.[2] || 0;
  let linesCount = Math.floor(
    (playResY - bottomSpace) / (paddingTop + defaultFontSize + paddingBottom),
  );

  // 首先以通用的字号把屏幕的高度分成若干行，字幕只允许落在一个行里
  return {
    // 每一行里的数字是当前在这一行里的最后一条弹幕区域（算入padding）的右边离开屏幕的时间，
    // 这个时间和下一条弹幕的左边离开屏幕的时间相比较，能确定在整个弹幕的飞行过程中是否会相撞（不同长度弹幕飞行速度不同），
    // 当每一条弹幕加到一行里时，就会把这个时间算出来，获取新的弹幕时就可以判断哪一行是允许放的就放进去
    [DanmakuMode.NORMAL]: Array(linesCount).fill({ width: 0, start: 0, end: 0 }),

    // 对于固定的弹幕，每一行里都存放弹幕的消失时间，只要这行的弹幕没消失就不能放新弹幕进来
    [DanmakuMode.TOP]: Array(linesCount).fill(0),
    [DanmakuMode.BOTTOM]: Array(linesCount).fill(0),
  };
}

function resolveAvailableScrollGrid(
  grids: NormalGrid[],
  rectWidth: number,
  screenWidth: number,
  time: number,
  duration: number,
) {
  for (let i = 0; i < grids.length; i++) {
    let previous = grids[i];

    // 对于滚动弹幕，要算两个位置：
    //
    // 1. 前一条弹幕的尾巴进屏幕之前，后一条弹幕不能开始出现
    // 2. 前一条弹幕的尾巴离开屏幕之前，后一条弹幕的头不能离开屏幕
    let previousInTime =
      previous.start + computeScrollInTime(previous.width, screenWidth, duration);
    let currentOverTime = time + computeScrollOverTime(rectWidth, screenWidth, duration);

    if (time >= previousInTime && currentOverTime >= previous.end) {
      return i;
    }
  }

  return -1;
}

/** 计算一个矩形移进屏幕的时间（头进屏幕到尾巴进屏幕） */
function computeScrollInTime(rectWidth: number, screenWidth: number, scrollTime: number) {
  let speed = (screenWidth + rectWidth) / scrollTime;
  return rectWidth / speed;
}

/** 计算一个矩形在屏幕上的时间（头进屏幕到头离开屏幕） */
function computeScrollOverTime(rectWidth: number, screenWidth: number, scrollTime: number) {
  let speed = (screenWidth + rectWidth) / scrollTime;
  return screenWidth / speed;
}

/** 找到能用的行 */
function resolveAvailableFixGrid(grids: number[], time: number) {
  for (let i = 0; i < grids.length; i++) {
    if (grids[i] <= time) {
      return i;
    }
  }
  return -1;
}

function generateAssContent(danmakuList: Danmaku[]) {
  let content = [generateAssInfo(), generateAssStyle(), generateAssEvent(danmakuList)];

  // if (options.includeRaw) {
  //   content.push(raw(rawList, context));
  // }

  return content.join("\n\n") + "\n";
}

function generateAssInfo() {
  const { playResX, playResY } = options;
  return `[Script Info]
Title: dan²ass
Original Script: 根据 ${pathObject.name} 的弹幕信息，由 dan²ass 生成
ScriptType: v4.00+
Collisions: Reverse
PlayResX: ${playResX}
PlayResY: ${playResY}
Timer: 100.0000
`;
}

function generateAssStyle() {
  const {
    fontName,
    fontSize,
    color: configColor,
    outlineColor,
    backColor,
    bold,
    outline,
    shadow,
    opacity,
  } = options;
  let fields = [
    "Name",
    "Fontname",
    "Fontsize",
    "PrimaryColour",
    "SecondaryColour",
    "OutlineColour",
    "BackColour",
    "Bold",
    "Italic",
    "Underline",
    "StrikeOut",
    "ScaleX",
    "ScaleY",
    "Spacing",
    "Angle",
    "BorderStyle",
    "Outline",
    "Shadow",
    "Alignment",
    "MarginL",
    "MarginR",
    "MarginV",
    "Encoding",
  ];
  // 默认白底黑框
  let primaryColorValue = formatColor(configColor || WHITE, opacity);
  // 边框和阴影颜色没给的话算一个出来，不是黑就是白
  let secondaryColor = getDecoratingColor(configColor || WHITE);
  let outlineColorValue = formatColor(outlineColor || secondaryColor || BLACK, opacity);
  let backColorValue = formatColor(backColor || secondaryColor || BLACK, opacity);
  let colorStyle = `${primaryColorValue},${primaryColorValue},${outlineColorValue},${backColorValue}`;

  let boldValue = bold ? "1" : "0";
  let fontStyle = `${boldValue},0,0,0,100,100,0,0,1,${outline},${shadow},7,0,0,0,0`;

  let fontDeclaration = (size: number, i: number) =>
    `Style: F${i},${fontName},${size},${colorStyle},${fontStyle}`;
  let content = ["[V4+ Styles]", "Format: " + fields.join(","), ...[fontSize].map(fontDeclaration)];
  return content.join("\n");
}

interface Color {
  r: number;
  g: number;
  b: number;
}

function formatColor({ r, g, b }: Color, opacity?: number) {
  let color = [b, g, r];

  if (opacity !== undefined) {
    let alpha = Math.round((1 - opacity) * 255);
    color.unshift(alpha);
  }

  return "&H" + color.map(decimalToHex).join("").toUpperCase();
}

function decimalToHex(n: number) {
  return n.toString(16).padStart(2, "0");
}

function getDecoratingColor(color: Color) {
  return isDarkColor(color) ? WHITE : BLACK;
}

/** 本函数实现复制自[us-danmaku](https://github.com/tiansh/us-danmaku)项目 */
function isDarkColor({ r, g, b }: Color) {
  return r * 0.299 + g * 0.587 + b * 0.114 < 0x30;
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

function generateAssEvent(danmakuList: Danmaku[]) {
  let content = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...danmakuList.map((danmaku) => generateAssDialogue(danmaku)),
  ];

  return content.join("\n");
}

function generateAssDialogue(danmaku: Danmaku) {
  let { text, time } = danmaku;
  let { scrollTime, fixTime } = options;

  let commands = [
    danmaku.mode === DanmakuMode.NORMAL ? scrollCommand(danmaku) : fixCommand(danmaku),
    // 所有网站的原始默认色是白色，所以白色的时候不用额外加和颜色相关的指令
    isWhite(danmaku.color) ? "" : colorCommand(danmaku.color),
    isWhite(danmaku.color) ? "" : borderColorCommand(getDecoratingColor(danmaku.color)),
  ];
  let fields = [
    0, // Layer,
    formatTime(time), // Start
    formatTime(time + (danmaku.mode === DanmakuMode.NORMAL ? scrollTime : fixTime)), // End
    "F0", // Style
    "", // Name
    "0000", // MarginL
    "0000", // MarginR
    "0000", // MarginV
    "", // Effect
    "{" + commands.join("") + "}" + encode(text), // Text
  ];

  return "Dialogue: " + fields.join(",");
}

let scrollCommand = (danmaku: Danmaku) =>
  `\\move(${danmaku.start},${danmaku.top},${danmaku.end},${danmaku.top})`;
let fixCommand = (danmaku: Danmaku) => `\\an8\\pos(${danmaku.left},${danmaku.top})`;
let colorCommand = (color: Color) => `\\c${formatColor(color)}`;
let borderColorCommand = (color: Color) => `\\3c${formatColor(color)}`;

let isWhite = (color: Color) => color.r === 255 && color.g === 255 && color.b === 255;

let formatTime = (seconds: number) => {
  let div = (i: number, j: number) => Math.floor(i / j);
  let pad = (n: number) => (n < 10 ? "0" + n : "" + n);

  let integer = Math.floor(seconds);
  let hour = div(integer, 60 * 60);
  let minute = div(integer, 60) % 60;
  let second = integer % 60;
  let minorSecond = Math.floor((seconds - integer) * 100); // 取小数部分2位

  return `${hour}:${pad(minute)}:${pad(second)}.${minorSecond}`;
};

let encode = (text: string) => text.replace(/\{/g, "｛").replace(/\}/g, "｝").replace(/\r|\n/g, "");

function openFileWithDefaultApp(filePath: string) {
  switch (process.platform) {
    case "darwin":
      exec(`open '${filePath}'`);
      break;
    case "win32":
      exec(`start '${filePath}'`);
      break;
    default:
      exec(`xdg-open '${filePath}'`);
  }
}
