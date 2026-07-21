import {
  MAX_DISCORD_ATTACHMENT_DISCORD_LABEL,
  MAX_DISCORD_ATTACHMENT_LABEL,
  MAX_DISCORD_FILES,
} from "./discordAttachmentLimits.js";

export const CODEX_DISCORD_HOW_TO_USE_PROMPT = [
  "이 Codex 세션은 Discord 채널과 연결되어 있습니다.",
  "Discord 사용자가 이 채널에 자연어를 보내면 지금 세션으로 이어지고, 최종 답변은 다시 Discord로 전송됩니다.",
  "Codex 작업 중 같은 채널에 보낸 일반 메시지는 현재 turn에 즉시 steering됩니다. 다음 turn으로 남기려면 /queue prompt:<요청>을 사용하세요. prompt 없는 /queue는 상태를 보여주고, /queue-clear는 대기 요청을 비우며, /interrupt는 현재 turn을 중단합니다. /steer는 명시적 steering 별칭으로 계속 사용할 수 있습니다.",
  "Claude Code 채널은 실행 중 steering을 지원하지 않으므로 일반 메시지는 안전하게 다음 요청으로 대기합니다. /queue prompt:<요청>으로도 명시적으로 예약할 수 있고, /steer와 /interrupt는 지원 안내를 표시합니다.",
  "",
  "Discord에 파일을 첨부해서 보내야 할 때는 최종 답변에 아래 JSON 블록을 포함하세요. 봇이 이 블록은 숨기고, 파일을 Discord 첨부로 올립니다.",
  "",
  "```codex-discord-send",
  "{",
  '  "message": "Discord 메시지에 같이 보여줄 문장",',
  '  "files": [',
  '    "/absolute/path/result.png",',
  '    {"path": "/absolute/path/demo.mp4", "name": "demo.mp4"},',
  '    {"path": "/absolute/path/audio.wav", "name": "audio.wav"}',
  "  ]",
  "}",
  "```",
  "",
  `규칙: files에는 이 컴퓨터의 절대경로 또는 file:// URL만 넣으세요. 이미지, 동영상, 오디오 등 존재하는 일반 파일만 첨부됩니다. 현재 이 봇은 파일당 최대 ${MAX_DISCORD_ATTACHMENT_LABEL}(Discord 표기 ${MAX_DISCORD_ATTACHMENT_DISCORD_LABEL}), 한 메시지당 최대 ${MAX_DISCORD_FILES}개 파일까지 첨부합니다. 이보다 큰 파일은 여러 파일로 쪼개서 올리거나, 압축/리사이즈/인코딩 옵션 조정으로 용량을 낮춘 뒤 첨부하세요. 민감한 파일은 첨부하지 마세요.`,
  "",
  "이 안내를 짧게 확인하고, 이후부터 필요할 때 이 형식을 사용하세요.",
].join("\n");
