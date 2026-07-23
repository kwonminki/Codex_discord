# Agent Relay Guide

Agent Relay는 별도 Discord Coordinator Bot이 두 agent session thread의 최종 공개 답변과 첨부파일을 번갈아 전달하는 선택 기능입니다. 같은 컴퓨터의 두 세션, 서로 다른 컴퓨터, Codex와 Claude Code의 조합을 모두 사용할 수 있습니다.

## 사용자 흐름

Agent thread A에서 실행합니다.

```text
/agent-chat parent:#agent-parent-b peer:agent-thread-b goal:두 구현을 비교하고 합의된 개선안을 만들어줘 max_rounds:20 timeout_minutes:120
```

`parent`에서 상대 agent의 부모 채널을 먼저 선택하면 `peer` autocomplete가 그 채널의 활성·archived thread를 검색합니다. Discord autocomplete는 한 번에 25개까지만 표시하므로 thread 이름 일부를 입력해 좁힐 수 있습니다. 목록에서 찾기 어려우면 thread ID, `<#thread-id>` mention 또는 Discord thread 링크를 직접 입력할 수 있습니다.

Coordinator는 private relay-control 채널로 A에 첫 실행 요청을 보내고, A의 최종 답변을 B의 입력으로 전달한 뒤 B의 답변을 다시 A로 전달합니다. 실행 규칙과 전체 입력 prompt는 작업 thread에 노출하지 않습니다. 상대 thread에는 agent의 최종 공개 답변과 첨부파일만 복사하며, 중간 진행·도구 event는 다음 agent의 입력으로 전달하지 않습니다. Agent가 `codex-discord-send`로 올린 파일은 source Connector가 relay-control 채널에 업로드하고 Coordinator가 target thread와 다음 비공개 요청에 다시 첨부합니다. 다른 컴퓨터에는 source의 로컬 경로가 아니라 Discord 첨부 bytes가 전달됩니다.

두 agent가 연속으로 `done`을 반환하면 정상 종료합니다. A와 B가 각각 한 번 답하는 것을 왕복 1회로 계산하며, 모든 agent prompt에는 현재 왕복과 개별 agent turn이 표시됩니다. Agent가 `extend`를 반환하면 Operator에게 추가 왕복을 요청하고 대화를 잠시 멈춥니다. 최종 알림의 **왕복 1회 추가** 버튼을 누르면 허용량을 agent turn 2개 늘리고 반대편 agent부터 재개하며, **연장 거절 · 대화 종료**를 누르면 즉시 `stopped` 처리하고 두 thread를 해제합니다. `max_rounds`, 전체 timeout, `blocked`, turn 실패 또는 `/agent-chat-stop`도 대화를 종료하며 최초 A thread에서 Operator 역할을 한 번 멘션합니다. 승인이나 사용자 질문은 기존 Connector가 즉시 Operator를 멘션하고 해당 turn을 기다립니다.

## Discord 구성

Coordinator는 기존 Connector와 다른 Discord Application/Bot이어야 합니다. 같은 private Guild에 한 번만 설치하고 다음 권한을 줍니다.

새 Discord Application 생성과 OAuth 초대 승인은 Discord 계정 소유자가 Developer Portal에서 한 번 수행해야 합니다. 기존 bot token이나 Discord Bot API로 다른 application을 생성할 수는 없습니다. 사용자는 application 생성, Message Content Intent 활성화, 초대 승인과 로컬 secret 입력만 하고, 설치 에이전트가 이후 private channel·역할·권한·ID 탐색·서비스 등록을 처리합니다.

- View Channels
- Send Messages
- Send Messages in Threads
- Read Message History
- Attach Files
- Use Application Commands

Developer Portal의 Bot 설정에서 Message Content Intent를 켭니다. Coordinator Bot에는 Connector가 사용하는 Operator 역할을 부여합니다. `agent-relay-control` 같은 private text channel을 하나 만들고 사람 일반 역할에는 숨기며, 기존 Connector Bot과 Coordinator Bot만 읽고 쓸 수 있게 합니다.

Coordinator runtime secret은 `.connect/relay-config.json`에 저장합니다.

```json
{
  "version": 1,
  "token": "SECOND_BOT_TOKEN",
  "guildId": "DISCORD_GUILD_ID",
  "operatorRoleIds": ["OPERATOR_ROLE_ID"],
  "controlChannelId": "PRIVATE_RELAY_CONTROL_CHANNEL_ID",
  "connectorBotUserIds": ["EXISTING_CONNECTOR_BOT_USER_ID"],
  "stateRoot": ".connect/agent-relay"
}
```

파일은 `0600`, 상위 `.connect`와 state directory는 `0700`으로 보호합니다. Token을 Git이나 Discord 메시지에 올리지 않습니다.

Relay에 참여할 모든 컴퓨터의 `.connect/config.json` Direct 설정에 같은 Coordinator Bot user ID와 control channel을 추가합니다.

```json
{
  "direct": {
    "relay": {
      "trustedBotUserIds": ["COORDINATOR_BOT_USER_ID"],
      "controlChannelId": "PRIVATE_RELAY_CONTROL_CHANNEL_ID"
    }
  }
}
```

각 Connector는 정확히 이 bot ID가 private control channel에 보낸 marker 요청만 bot-authored 예외로 받고, marker가 가리킨 자기 소유 agent thread에서 실행합니다. 작업 thread의 일반 bot 메시지, shell admin channel과 다른 bot 메시지는 계속 거부합니다.

## 실행

```bash
pnpm connect start --direct --component relay
```

macOS에서는 기존 `scripts/start-mac-direct.sh relay`를 호출하는 별도 LaunchAgent를 만들고, Ubuntu에서는 같은 명령의 별도 systemd service를 만듭니다. Native Windows에서는 `scripts/install-windows-tasks.ps1 -IncludeRelay`로 별도 Relay Scheduled Task를 추가합니다. Coordinator만 재시작해도 `.connect/agent-relay/conversations.json`에서 대화 상태를 복구하고 relay-control 채널의 최근 결과를 다시 확인합니다.

각 Connector bot service는 relay 설정 적용 후 한 번 재시작해야 하지만 독립 Direct Worker는 재시작하지 않습니다. 실행 중 agent job을 유지한 채 gateway만 갱신할 수 있습니다.

## 명령

- `/agent-chat`: 상대 부모 채널과 thread를 검색 선택해 대화 시작. `max_rounds`로 최초 왕복 제한 설정
- `/agent-chat-status`: 현재 또는 최근 대화 상태 확인
- `/agent-chat-stop`: 이후 turn 전달 중지. 이미 실행 중인 agent turn 자체는 즉시 kill하지 않음

## 한도와 주의사항

- 기본 20 왕복, 120분이며 명령에서 조정할 수 있습니다. 왕복 1회는 A와 B의 답변 하나씩, 즉 agent turn 2개입니다.
- `extend` 요청 알림의 **왕복 1회 추가**와 **연장 거절 · 대화 종료** 버튼은 Operator role만 사용할 수 있습니다. 승인은 agent turn 2개를 추가하고, 거절은 대화를 `stopped` 처리해 두 thread를 해제합니다. 동시에 누르거나 이미 처리된 버튼을 다시 누르면 먼저 처리된 동작만 성공합니다.
- 한 turn에서 다른 서버로 relay하는 source 결과 파일은 최대 9개, 파일당 10MiB입니다. 긴 peer 답변은 열 번째 text attachment로 전달될 수 있습니다.
- Relay가 진행되는 두 session을 Desktop/IDE나 일반 Discord 요청으로 동시에 사용하지 않는 것이 좋습니다. 사람 메시지는 relay turn에 steering되지 않고 별도 queue로 들어가지만, session 맥락 자체는 공유됩니다.
- 일반 bot 메시지 허용으로 구현하지 마세요. exact Coordinator Bot ID, private control channel ID, exact request marker, target agent thread mode와 machine-readable result callback 검증을 모두 유지해야 합니다. Coordinator가 작업 thread에 남긴 공개 안내와 상대 답변 복사본은 실행 요청이 아닙니다.
- Coordinator는 Guild당 한 인스턴스만 실행합니다. 여러 Connector 컴퓨터가 같은 Coordinator와 control channel을 공유하는 것은 정상입니다.
