import {
  localizeConnectorText,
  type ConnectorLocale,
} from "../../../packages/core/src/index.js";
import {
  MAX_DISCORD_ATTACHMENT_DISCORD_LABEL,
  MAX_DISCORD_ATTACHMENT_LABEL,
} from "./discordAttachmentLimits.js";

export const CODEX_DISCORD_HOW_TO_USE_PROMPT = [
  "이 agent 세션의 최종 답변은 연결된 Discord 채널로 전송됩니다.",
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
  `규칙: files에는 이 컴퓨터의 절대경로 또는 file:// URL만 넣으세요. 이미지, 동영상, 오디오 등 존재하는 일반 파일만 첨부됩니다. 파일 개수가 많으면 봇이 파일 전용 Discord 메시지 여러 개로 자동 분할하며, 답변 글과 첨부파일은 서로 다른 메시지로 전송됩니다. 현재 파일당 최대 ${MAX_DISCORD_ATTACHMENT_LABEL}(Discord 표기 ${MAX_DISCORD_ATTACHMENT_DISCORD_LABEL})입니다. 이보다 큰 파일은 여러 파일로 쪼개서 올리거나, 압축/리사이즈/인코딩 옵션 조정으로 용량을 낮춘 뒤 첨부하세요. 민감한 파일은 첨부하지 마세요.`,
  "",
  "최종 미디어 설문: 최종 답변을 보낸 뒤 사용자가 이미지, 영상 또는 오디오를 보고 선택하게 하려면 아래 블록을 포함하세요. 봇은 블록을 숨기고 미디어와 선택 메뉴를 별도 메시지로 올립니다. 사용자의 선택은 같은 Codex 또는 Claude Code 세션의 다음 turn으로 queue됩니다.",
  "",
  "```codex-discord-survey",
  "{",
  '  "message": "비교 결과를 확인해 주세요.",',
  '  "question": "어느 결과가 가장 자연스럽나요?",',
  '  "files": ["/absolute/path/comparison.mp4"],',
  '  "options": [',
  '    {"label": "A가 좋음", "description": "동작이 자연스러움"},',
  '    {"label": "B가 좋음", "description": "화질이 선명함"},',
  '    "둘 다 수정 필요"',
  "  ],",
  '  "multiple": false',
  "}",
  "```",
  "",
  "중간 미디어 질문: 현재 agent가 Codex app-server이고 작업을 계속하려면 사용자의 선택이 필요할 때 request_user_input을 사용하세요. 일반 options는 request_user_input의 선택지에 넣고, question 문자열 안에 files와 multiple을 담은 codex-discord-survey 블록을 포함하세요. 봇이 Operator role을 멘션하고, 선택 메뉴 응답을 새 작업이 아닌 현재 실행 중 turn으로 즉시 전달합니다. 사용자는 메뉴 대신 번호, 선택지 이름 또는 자유 문장으로도 답할 수 있습니다.",
  "",
  "request_user_input question 예시:",
  "생성한 영상을 보고 수정 방향을 선택해 주세요.",
  "```codex-discord-survey",
  '{"files":["/absolute/path/preview.mp4"],"multiple":false}',
  "```",
  "request_user_input options: 일반 2~3개 선택지",
  "",
  "질문은 짧고 서로 배타적인 2~3개 선택지를 우선 사용하고, 비밀번호나 토큰 같은 비밀 정보는 요청하지 마세요.",
  "Claude Code headless 실행에는 이 실시간 질문 왕복이 아직 연결되어 있지 않습니다. Claude Code에서는 꼭 필요한 질문을 일반 답변으로 남기고 현재 요청을 종료하세요. 사용자의 다음 Discord 메시지가 후속 turn으로 전달됩니다.",
  "",
  "Codex 또는 Claude Code 중 현재 실행 중인 agent로서 이 안내를 짧게 확인하고, 이후부터 필요할 때 이 형식을 사용하세요.",
].join("\n");

export function codexDiscordHowToUsePrompt(
  locale: ConnectorLocale = "ko",
): string {
  return localizeConnectorText(CODEX_DISCORD_HOW_TO_USE_PROMPT, locale);
}
