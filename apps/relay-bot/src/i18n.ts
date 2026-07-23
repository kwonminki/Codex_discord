import type { ConnectorLocale } from "../../../packages/core/src/index.js";
import type { RelayConversationStatus } from "./store.js";

export interface RelayLocaleText {
  commandStart: string;
  commandParent: string;
  commandPeer: string;
  commandGoal: string;
  commandMaxRounds: string;
  commandTimeout: string;
  commandStatus: string;
  commandStop: string;
  buttonExtend: string;
  buttonReject: string;
  archived: string;
  unauthorized: string;
  extensionGranted: string;
  extensionRejected: string;
  extensionFailed: string;
  goalRequired: string;
  peerRequired: string;
  distinctThreadsRequired: string;
  conversationStarted: string;
  stopHint: string;
  conversationStopped: string;
  noActiveConversation: string;
  commandFailed: string;
  noFinalText: string;
  finalNoticeTitle: string;
  conversation: string;
  conversationId: string;
  state: string;
  progress: string;
  roundTrip: string;
  lastAgent: string;
  noneYet: string;
  details: string;
  endReason: string;
  status: Record<RelayConversationStatus, string>;
}

const relayLocales: Readonly<Record<ConnectorLocale, RelayLocaleText>> = {
  ko: {
    commandStart: "현재 agent thread와 다른 agent thread 사이의 relay 대화를 시작합니다.",
    commandParent: "상대 agent thread가 들어 있는 부모 채널",
    commandPeer: "상대 thread 검색 또는 thread ID/링크",
    commandGoal: "두 agent가 논의하고 합의할 목표",
    commandMaxRounds: "최대 왕복 횟수 (A와 B가 각각 답하면 1회, 기본 20)",
    commandTimeout: "전체 대화 제한 시간(분, 기본 1200)",
    commandStatus: "현재 thread의 agent relay 대화 상태를 확인합니다.",
    commandStop: "현재 thread가 참여 중인 agent relay 대화를 중지합니다.",
    buttonExtend: "왕복 1회 추가",
    buttonReject: "연장 거절 · 대화 종료",
    archived: "보관됨",
    unauthorized: "이 명령을 사용할 수 있는 operator role이 없습니다.",
    extensionGranted: "왕복 1회를 추가하고 대화를 재개했습니다.",
    extensionRejected: "추가 왕복을 거절하고 대화를 종료했습니다.",
    extensionFailed: "추가 왕복 요청을 처리하지 못했습니다",
    goalRequired: "대화 목표가 비어 있습니다.",
    peerRequired: "상대 thread를 검색 선택하거나 thread ID/링크를 입력하세요.",
    distinctThreadsRequired: "/agent-chat은 서로 다른 두 agent thread 사이에서만 시작할 수 있습니다.",
    conversationStarted: "Agent relay 대화를 시작했습니다.",
    stopHint: "사람이 중간에 멈추려면 두 스레드 중 어느 쪽에서든 `/agent-chat-stop`을 실행하세요.",
    conversationStopped: "Agent relay 대화를 중지했습니다.",
    noActiveConversation: "현재 thread에는 실행 중인 agent relay 대화가 없습니다.",
    commandFailed: "Agent relay 명령이 실패했습니다",
    noFinalText: "최종 텍스트 답변이 없습니다.",
    finalNoticeTitle: "Agent relay 결과",
    conversation: "대화",
    conversationId: "대화 ID",
    state: "상태",
    progress: "진행",
    roundTrip: "왕복",
    lastAgent: "마지막 agent",
    noneYet: "아직 없음",
    details: "상세",
    endReason: "종료 사유",
    status: {
      running: "진행 중",
      "extension-requested": "추가 왕복 요청",
      completed: "합의 완료",
      "max-rounds": "최대 라운드 도달",
      blocked: "사용자 확인 필요",
      failed: "실패",
      stopped: "사용자 중지",
      "timed-out": "시간 초과",
    },
  },
  en: {
    commandStart: "Start a relay conversation between this agent thread and another agent thread.",
    commandParent: "Parent channel containing the peer agent thread",
    commandPeer: "Search for a peer thread or enter its ID/link",
    commandGoal: "Goal for the two agents to discuss and agree on",
    commandMaxRounds: "Maximum round trips (A plus B is one, default 20)",
    commandTimeout: "Whole-conversation timeout in minutes (default 1200)",
    commandStatus: "Show the Agent Relay conversation state for this thread.",
    commandStop: "Stop the Agent Relay conversation involving this thread.",
    buttonExtend: "Add one round trip",
    buttonReject: "Reject extension and stop",
    archived: "archived",
    unauthorized: "You do not have an Operator role allowed to use this command.",
    extensionGranted: "Added one round trip and resumed the conversation.",
    extensionRejected: "Rejected the extension and stopped the conversation.",
    extensionFailed: "Could not process the extension request",
    goalRequired: "The conversation goal is empty.",
    peerRequired: "Select a peer thread or enter its thread ID/link.",
    distinctThreadsRequired: "/agent-chat requires two different agent threads.",
    conversationStarted: "Started the Agent Relay conversation.",
    stopHint: "To stop it manually, run `/agent-chat-stop` in either thread.",
    conversationStopped: "Stopped the Agent Relay conversation.",
    noActiveConversation: "This thread has no active Agent Relay conversation.",
    commandFailed: "Agent Relay command failed",
    noFinalText: "No final text response was provided.",
    finalNoticeTitle: "Agent Relay result",
    conversation: "Conversation",
    conversationId: "Conversation ID",
    state: "State",
    progress: "Progress",
    roundTrip: "round trip",
    lastAgent: "Last agent",
    noneYet: "none yet",
    details: "Details",
    endReason: "End reason",
    status: {
      running: "Running",
      "extension-requested": "Extension requested",
      completed: "Agreement completed",
      "max-rounds": "Maximum rounds reached",
      blocked: "User input required",
      failed: "Failed",
      stopped: "Stopped by user",
      "timed-out": "Timed out",
    },
  },
  zh: {
    commandStart: "在当前 agent 线程与另一个 agent 线程之间启动中继对话。",
    commandParent: "包含对方 agent 线程的父频道",
    commandPeer: "搜索对方线程，或输入线程 ID/链接",
    commandGoal: "两个 agent 要讨论并达成共识的目标",
    commandMaxRounds: "最大往返次数（A、B 各回答一次算 1 次，默认 20）",
    commandTimeout: "整个对话的超时时间（分钟，默认 1200）",
    commandStatus: "查看当前线程的 Agent Relay 对话状态。",
    commandStop: "停止当前线程参与的 Agent Relay 对话。",
    buttonExtend: "增加 1 次往返",
    buttonReject: "拒绝延长并结束",
    archived: "已归档",
    unauthorized: "你没有可使用此命令的 Operator 角色。",
    extensionGranted: "已增加 1 次往返并恢复对话。",
    extensionRejected: "已拒绝延长并结束对话。",
    extensionFailed: "无法处理延长请求",
    goalRequired: "对话目标为空。",
    peerRequired: "请选择对方线程，或输入线程 ID/链接。",
    distinctThreadsRequired: "/agent-chat 只能在两个不同的 agent 线程之间启动。",
    conversationStarted: "已启动 Agent Relay 对话。",
    stopHint: "如需人工中途停止，请在任一线程中运行 `/agent-chat-stop`。",
    conversationStopped: "已停止 Agent Relay 对话。",
    noActiveConversation: "当前线程没有正在运行的 Agent Relay 对话。",
    commandFailed: "Agent Relay 命令失败",
    noFinalText: "没有最终文本回答。",
    finalNoticeTitle: "Agent Relay 结果",
    conversation: "对话",
    conversationId: "对话 ID",
    state: "状态",
    progress: "进度",
    roundTrip: "往返",
    lastAgent: "最后一个 agent",
    noneYet: "暂无",
    details: "详情",
    endReason: "结束原因",
    status: {
      running: "进行中",
      "extension-requested": "请求增加往返",
      completed: "已达成共识",
      "max-rounds": "已达到最大轮数",
      blocked: "需要用户确认",
      failed: "失败",
      stopped: "用户已停止",
      "timed-out": "已超时",
    },
  },
  ja: {
    commandStart: "現在の agent スレッドと別の agent スレッドの間で relay 会話を開始します。",
    commandParent: "相手の agent スレッドがある親チャンネル",
    commandPeer: "相手スレッドを検索、またはスレッド ID/リンクを入力",
    commandGoal: "2つの agent が議論して合意する目標",
    commandMaxRounds: "最大往復回数（AとBが各1回答で1回、既定20）",
    commandTimeout: "会話全体のタイムアウト（分、既定1200）",
    commandStatus: "現在のスレッドの Agent Relay 会話状態を表示します。",
    commandStop: "現在のスレッドが参加中の Agent Relay 会話を停止します。",
    buttonExtend: "往復を1回追加",
    buttonReject: "延長を拒否して終了",
    archived: "アーカイブ済み",
    unauthorized: "このコマンドを使用できる Operator ロールがありません。",
    extensionGranted: "往復を1回追加して会話を再開しました。",
    extensionRejected: "延長を拒否して会話を終了しました。",
    extensionFailed: "延長リクエストを処理できませんでした",
    goalRequired: "会話の目標が空です。",
    peerRequired: "相手スレッドを選択するか、スレッド ID/リンクを入力してください。",
    distinctThreadsRequired: "/agent-chat は異なる2つの agent スレッド間でのみ開始できます。",
    conversationStarted: "Agent Relay 会話を開始しました。",
    stopHint: "途中で停止する場合は、どちらかのスレッドで `/agent-chat-stop` を実行してください。",
    conversationStopped: "Agent Relay 会話を停止しました。",
    noActiveConversation: "現在のスレッドには実行中の Agent Relay 会話がありません。",
    commandFailed: "Agent Relay コマンドに失敗しました",
    noFinalText: "最終テキスト回答がありません。",
    finalNoticeTitle: "Agent Relay の結果",
    conversation: "会話",
    conversationId: "会話 ID",
    state: "状態",
    progress: "進行状況",
    roundTrip: "往復",
    lastAgent: "最後の agent",
    noneYet: "まだありません",
    details: "詳細",
    endReason: "終了理由",
    status: {
      running: "進行中",
      "extension-requested": "往復追加を申請中",
      completed: "合意完了",
      "max-rounds": "最大ラウンドに到達",
      blocked: "ユーザー確認が必要",
      failed: "失敗",
      stopped: "ユーザーが停止",
      "timed-out": "タイムアウト",
    },
  },
};

export function relayLocaleText(locale: ConnectorLocale): RelayLocaleText {
  return relayLocales[locale];
}
