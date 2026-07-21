import {
  MAX_DISCORD_ATTACHMENT_DISCORD_LABEL,
  MAX_DISCORD_ATTACHMENT_LABEL,
  MAX_DISCORD_FILES,
} from "./discordAttachmentLimits.js";

export const CODEX_DISCORD_HOW_TO_USE_PROMPT = [
  "이 Codex 세션의 최종 답변은 연결된 Discord 채널로 전송됩니다.",
  "입력 첨부파일: Discord 사용자는 특별한 형식이나 JSON 없이 일반 채팅 메시지에 이미지, 영상, 오디오 또는 파일을 그냥 첨부합니다. 파일만 보내거나 설명을 함께 적어도 됩니다.",
  "봇이 첨부파일을 이 컴퓨터의 임시 저장소에 내려받고 prompt 끝에 원래 파일명, MIME type, 크기, localPath metadata를 자동으로 추가합니다. localPath의 파일을 직접 열어 사용자의 요청을 처리하세요. 사용자에게 경로 변환을 요구하지 마세요.",
  "출력 첨부파일: 일반 텍스트 답변에는 별도 형식이 필요하지 않습니다. 작업 결과로 생긴 로컬 파일을 Discord 사용자에게 다시 첨부해서 보내야 할 때만 아래 JSON 블록을 최종 답변에 포함하세요. 봇이 이 블록은 숨기고, message는 본문으로 표시하며 files는 Discord 첨부로 올립니다.",
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
