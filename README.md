# AI Agent Discord Connector

[![Version](https://img.shields.io/github/v/tag/kwonminki/ai-agent-discord-connector?sort=semver&label=version)](https://github.com/kwonminki/ai-agent-discord-connector/tags)
[![Windows compatibility](https://github.com/kwonminki/ai-agent-discord-connector/actions/workflows/windows-compatibility.yml/badge.svg)](https://github.com/kwonminki/ai-agent-discord-connector/actions/workflows/windows-compatibility.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%5E20.19%20%7C%7C%20%3E%3D22.12-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Ubuntu-555555)](#여러-컴퓨터-사용)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

한국어 | [English](README.en.md)

**현재 안정 버전: v1.0.0**

Mac, Windows, Ubuntu 서버에서 실행되는 **Codex와 Claude Code 같은 AI agent를 Discord 스레드로 사용하는 개인용 브리지**입니다.

Discord에서 평소처럼 메시지를 보내면 agent가 연결된 컴퓨터에서 작업하고, 중요한 진행 상황과 최종 답변을 Discord로 돌려줍니다. 이미지, 영상, 오디오, 일반 파일도 양방향으로 주고받을 수 있습니다.

Codex만, Claude Code만, 또는 둘 다 연결할 수 있습니다. Connector가 어느 하나를 고정된 메인 agent로 가정하지 않으며, 둘 다 사용할 때는 메시지를 보낸 부모 채널에 따라 해당 agent로 연결됩니다.

> 이 봇은 연결된 컴퓨터에서 파일을 수정하고 명령을 실행할 수 있습니다. 신뢰하는 개인 Discord 서버와 본인이 관리하는 컴퓨터에서만 사용하세요.

## 시작하기

설치 절차를 직접 따라갈 필요가 없습니다. 아래 저장소 주소와 요청을 Codex 또는 Claude Code 같은 AI 에이전트에게 보내세요.

```text
https://github.com/kwonminki/ai-agent-discord-connector

이 저장소의 AI Agent Guide를 먼저 읽고 내 컴퓨터에 설치하고 설정해줘.
필요한 계정 작업만 한 단계씩 나에게 요청하고, 나머지는 직접 구성하고 검증해줘.
```

에이전트는 대화 언어와 운영체제를 알아서 확인하고, Codex와 Claude Code 중 무엇을 연결할지 물은 뒤 선택한 agent에 필요한 Discord 채널과 로컬 서비스를 구성합니다. 첫 컴퓨터가 준비되면 추가로 연결할 Mac, Windows 또는 Ubuntu 서버가 있는지도 물어봅니다.

## 지원 언어

Connector UI는 다음 언어를 지원합니다.

- 한국어
- 영어
- 중국어(간체)
- 일본어

설치 에이전트가 현재 대화 언어를 보고 자동으로 설정합니다. 버튼, 모달, 상태 문구, slash command 설명과 `/howtouse`가 선택된 언어로 표시되며, 사용자 메시지와 agent 답변 원문은 임의로 번역하지 않습니다.

## Discord에서 사용하기

### 새 채팅

Codex 또는 Claude Code 부모 채널에서 `/chat-new`를 실행하면 새 Discord 스레드와 agent 세션이 만들어집니다.

둘 다 활성화한 경우 Codex 부모 채널에서 만든 스레드는 Codex로, Claude Code 부모 채널에서 만든 스레드는 Claude Code로 이어집니다. 별도의 전역 메인 agent는 없습니다.

```text
/chat-new name:로그인 버그 수정
```

만들어진 스레드에서는 자연어로 요청하면 됩니다.

```text
현재 코드 구조를 확인하고 로그인 오류를 고쳐줘.
테스트까지 실행한 뒤 결과를 알려줘.
이 영상에서 문제가 생기는 구간을 찾아줘.
```

### 진행 중 지시와 대기열

Codex가 작업 중일 때 같은 스레드에 보내는 일반 메시지는 현재 작업에 즉시 반영됩니다. 현재 작업이 끝난 다음 별도 작업으로 실행하려면 `/queue prompt:`를 사용하세요.

```text
/queue prompt:현재 수정이 끝나면 전체 테스트도 실행해줘
```

Claude Code의 현재 headless 실행은 live steering을 지원하지 않으므로 작업 중 보낸 일반 메시지도 다음 작업으로 대기합니다.

### 세션 분기

기존 대화 맥락을 복제해 다른 방향으로 작업하려면 세션 스레드에서 `/fork`를 사용합니다. 원본과 fork 스레드는 서로 다른 agent 세션으로 이어집니다.

### 자주 쓰는 명령

| 명령 | 용도 |
| --- | --- |
| `/chat-new` | 새 Discord 스레드와 agent 세션 만들기 |
| `/status` | 실행 상태, 마지막 활동, 대기열과 모델 설정 확인 |
| `/settings` | 현재 적용되는 모델과 effort 확인 |
| `/model` | 부모 채널 기본값 또는 현재 스레드 모델 변경 |
| `/effort` | 부모 채널 기본값 또는 현재 스레드 effort 변경 |
| `/steer` | 실행 중인 Codex 작업에 명시적으로 지시 추가 |
| `/queue` | 다음 turn 예약 또는 대기열 상태 확인 |
| `/queue-clear` | 아직 시작하지 않은 요청 삭제 |
| `/interrupt` | 현재 Codex turn 중단 |
| `/fork` | 현재 세션 맥락을 복제해 새 스레드 만들기 |
| `/howtouse` | 현재 agent에게 Discord 파일·설문 전송법 알려주기 |
| `/where` | 현재 컴퓨터, 작업 폴더와 session ID 확인 |

## 파일과 미디어

Discord 메시지에 이미지, 영상, 오디오, 문서 또는 압축 파일을 그냥 첨부하고 원하는 작업을 적으면 됩니다. 봇이 연결된 컴퓨터에 임시 저장한 뒤 agent에게 전달합니다.

세션에서 `/howtouse`를 한 번 실행하면 agent가 결과 파일과 미디어 설문을 Discord로 보내는 형식을 알게 됩니다. 이후에는 자연어로 요청하세요.

```text
결과 영상과 로그 파일을 Discord에 첨부해서 보내줘.
두 결과 영상을 보내고 어느 쪽이 좋은지 선택하게 해줘.
```

- 입력 기본 제한: 메시지당 10개, 파일당 100MiB, 전체 250MiB
- 출력 기본 안전 한도: 파일당 10MiB
- Discord 서버 자체 업로드 제한이 더 작으면 그 제한이 먼저 적용됩니다.
- 큰 파일은 agent에게 압축, 리사이즈, 재인코딩 또는 분할을 요청하세요.

## 알림

전용 private Discord 서버라면 설치 에이전트가 서버 전체의 기본 알림을 **멘션만(Only @mentions)** 으로 설정합니다. 공유 서버에서는 다른 채널과 사용자에게 영향을 줄 수 있으므로 먼저 동의를 받습니다.

- 중요한 중간 설명은 태그 없이 조용히 쌓입니다.
- 질문, 권한 요청, 최종 완료와 실패는 Operator 역할 멘션으로 알림이 옵니다.
- 긴 최종 답변은 여러 메시지 또는 원문 텍스트 파일로 전달됩니다.
- Discord의 사용자별 채널 알림 override는 bot이 변경할 수 없습니다. 예전에 직접 다른 값으로 바꾼 채널만 사용자가 **멘션만**으로 되돌리면 됩니다.

## 여러 컴퓨터 사용

같은 private Discord 서버에서 여러 Mac, Windows와 Ubuntu 서버를 함께 사용할 수 있습니다. 첫 설치가 끝난 뒤 에이전트에게 다음처럼 말하면 됩니다.

```text
Windows 컴퓨터 하나를 이 Discord connector에 추가로 연결해줘.
```

에이전트가 서버 종류와 접속 방법, 작업 폴더, 사용할 agent 조합(Codex만, Claude Code만, 둘 다)을 순서대로 확인하고 기존 Discord 구성을 재사용해 필요한 채널과 서비스를 준비합니다.

## 주의사항

### 답변 생성 중에는 같은 세션에 다른 화면에서 말 걸지 마세요

Codex Desktop, VS Code, Antigravity 같은 IDE 또는 Discord에서 답변을 생성하고 있는 동안, 다른 화면에서 같은 session ID에 새 메시지를 보내면 두 turn이 겹칠 수 있습니다. 이때 메시지 순서가 바뀌거나 진행 과정과 최종 답변이 예상하지 않은 화면에 나타날 수 있습니다.

현재 답변이 **완전히 종료된 뒤에는** 같은 세션을 Desktop, IDE, Discord 어디에서든 이어서 사용해도 괜찮습니다. 답변이 끝나기 전에 다른 요청도 시작해야 한다면 `/fork` 또는 `/chat-new`로 별도 세션을 만드세요.

### 서비스 종료 범위가 다릅니다

- Discord bot만 재시작하면 실행 중인 작업은 독립 worker에서 계속됩니다.
- Worker 강제 종료나 컴퓨터 재부팅은 실행 중인 agent와 하위 프로세스를 중단할 수 있습니다.

### 권한은 강력합니다

기본 자동화 설정은 agent가 연결된 컴퓨터의 파일과 명령에 폭넓게 접근할 수 있습니다. 공개 Discord 서버나 신뢰하지 않는 역할에는 연결하지 말고, 토큰과 비밀번호를 Discord 메시지로 보내지 마세요.

## 문서

- [AI Agent Guide](docs/AI_AGENT_GUIDE.md): 설치, 업데이트, 서비스 운영과 문제 해결을 위한 에이전트 전용 문서
- [English AI Agent Guide](docs/AI_AGENT_GUIDE.en.md)
- [Localization Guide](docs/localization.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## 라이선스

MIT

이 프로젝트는 [joungminsung/codex-discord-connector](https://github.com/joungminsung/codex-discord-connector)의 아이디어와 초기 기반에서 출발했으며, 좋은 출발점을 공개해주신 원작자에게 감사드립니다. 현재 버전은 multi-agent 지원, 독립 worker 구조, 다중 컴퓨터 운영, 파일·미디어 왕복, 다국어 UI와 크로스 플랫폼 배포를 포함해 코드베이스와 사용 흐름 대부분을 폭넓게 재설계하고 확장했습니다.
