# Ubuntu Server Direct Mode Setup

이 문서는 SSH로 접속해서 쓰는 Ubuntu 서버에서도 Codex 작업 완료 알림을 같은 Discord 서버로 받기 위한 설치 절차입니다.

목표는 단순합니다.

```text
Ubuntu server Codex
  -> Ubuntu server ~/.codex session log
  -> Ubuntu server codex-discord-connector
  -> Discord 완료 알림
```

## 중요한 전제

- Ubuntu 서버에서 실행한 Codex 기록은 보통 그 서버의 `$HOME/.codex`에 저장됩니다.
- Mac에서 실행 중인 connector는 Ubuntu 서버의 `$HOME/.codex`를 볼 수 없습니다.
- 따라서 Ubuntu 서버에서 끝난 Codex 작업 완료 알림을 받으려면 Ubuntu 서버에도 connector를 하나 실행해야 합니다.
- systemd 서비스는 SSH IDE에서 Codex를 실행하는 같은 Linux user로 띄우는 것을 권장합니다. user가 다르면 connector가 다른 `$HOME/.codex`를 보게 됩니다.

## 같은 Discord bot token 사용 시 주의

서버가 한두 대라면 같은 Discord bot token을 써도 운영은 가능합니다. 다만 아래 규칙을 지키세요.

- Mac과 Ubuntu가 같은 Discord admin channel을 쓰지 않게 합니다.
- Ubuntu 전용 admin channel을 새로 만듭니다. 예: `#ubuntu-codex-admin`.
- Mac connector의 `--channel-id`와 Ubuntu connector의 `--channel-id`는 달라야 합니다.
- operator role은 같은 role을 써도 됩니다.
- 같은 bot token으로 여러 프로세스를 띄우면 모든 프로세스가 Discord event를 볼 수 있으므로, 채널 분리가 사실상 안전장치입니다.

더 안정적인 구성은 서버별 Discord bot을 따로 만드는 것입니다. 하지만 개인용 private Discord 서버에서 Mac 1대, Ubuntu 1대 정도를 알림 위주로 쓰는 경우에는 채널만 분리해도 충분히 단순하게 운영할 수 있습니다.

## Discord 준비

이미 Mac용 bot을 만들어 초대한 상태라면 새 bot을 만들 필요는 없습니다.

1. Discord 서버에 Ubuntu용 private admin channel을 만듭니다.
   - 예: `#ubuntu-codex-admin`
2. 기존 `Codex Operator` role이 그 채널을 볼 수 있게 합니다.
3. Discord Developer Mode를 켜고 아래 값을 복사합니다.
   - Discord bot token
   - Discord guild/server ID
   - Operator role ID
   - Ubuntu admin channel ID

Bot 권한은 Mac 설치와 동일하게 필요합니다.

- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Attach Files
- Manage Messages, optional for `/clear`

## Ubuntu 패키지 설치

Ubuntu 서버에 SSH로 접속합니다.

```bash
ssh user@ubuntu-server
```

Node.js 22와 git을 설치합니다.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

pnpm을 활성화합니다.

```bash
sudo corepack enable
corepack prepare pnpm@9.15.0 --activate
node --version
pnpm --version
```

Codex도 같은 user에서 동작해야 합니다.

```bash
codex --version
ls -la "$HOME/.codex"
```

`$HOME/.codex`가 없으면, 먼저 이 Ubuntu user로 Codex를 한 번 실행하거나 IDE에서 Codex 로그인을 완료하세요.

## repo clone

원격 서버에서 이 fork를 clone합니다.

```bash
mkdir -p "$HOME/Codes"
cd "$HOME/Codes"
git clone git@github.com:kwonminki/Codex_discord.git
cd Codex_discord
```

서버에 GitHub SSH key가 아직 없다면 HTTPS로 clone해도 됩니다.

```bash
git clone https://github.com/kwonminki/Codex_discord.git
```

의존성을 설치하고 기본 검사를 실행합니다.

```bash
pnpm install
pnpm typecheck
```

## Direct mode 설정

아래 명령은 Ubuntu 서버의 Codex home을 보고, 완료 알림을 Ubuntu 전용 Discord admin channel 또는 세션별 thread로 보냅니다.

```bash
pnpm connect install --direct \
  --token "DISCORD_BOT_TOKEN" \
  --guild-id "DISCORD_GUILD_ID" \
  --role-ids "OPERATOR_ROLE_ID" \
  --channel-id "UBUNTU_ADMIN_CHANNEL_ID" \
  --workspace-root "$HOME" \
  --initial-cwd "$HOME" \
  --workspace-name "Ubuntu Server Codex" \
  --computer-id "ubuntu-server-1" \
  --computer-name "Ubuntu Server" \
  --codex-home "$HOME/.codex"
```

설정이 끝나면 아래 파일이 생깁니다.

```text
.connect/config.json
.env
```

이 파일들은 token과 로컬 상태를 담으므로 commit하지 않습니다.

## 수동 실행 테스트

먼저 foreground에서 실행합니다.

```bash
pnpm connect start --direct
```

Discord의 Ubuntu admin channel에서 확인합니다.

```text
where
sync status
```

이후 Ubuntu 서버에서 Codex 작업 하나를 끝내면 Discord에 완료 알림이 와야 합니다.

```bash
cd "$HOME"
codex
```

SSH IDE, VS Code Remote SSH, Antigravity Remote에서 실행한 Codex도 같은 Linux user의 `$HOME/.codex`에 기록된다면 완료 알림 대상입니다.

## systemd 자동 실행

수동 실행이 확인되면 systemd service로 등록합니다.

아래에서 `USER_NAME`과 `REPO_DIR`를 실제 값으로 바꿉니다.

```bash
whoami
pwd
```

예를 들어 user가 `ubuntu`, repo가 `/home/ubuntu/Codes/Codex_discord`라면:

```bash
sudo tee /etc/systemd/system/codex-discord-connector.service >/dev/null <<'EOF'
[Unit]
Description=Codex Discord Connector for Ubuntu Codex notifications
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Codes/Codex_discord
Environment=NODE_ENV=production
Environment=CONNECT_TASK_NOTIFICATION_INTERVAL_MS=3000
Environment=CONNECT_TRANSCRIPT_SYNC_INTERVAL_MS=5000
Environment=CONNECT_BACKGROUND_POLL_MAX_INTERVAL_MS=20000
Environment=CONNECT_BACKGROUND_MAX_LOAD=0.7
ExecStart=/usr/bin/env pnpm connect start --direct
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

서비스를 활성화합니다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codex-discord-connector
sudo systemctl status codex-discord-connector --no-pager
```

로그 확인:

```bash
journalctl -u codex-discord-connector -f
```

## GPU와 sandbox

GPU 작업을 서버에서 실행하려면 먼저 Codex 밖에서 GPU가 보여야 합니다.

```bash
nvidia-smi
ls -l /dev/nvidia* /dev/dri/renderD* 2>/dev/null
groups "$USER"
```

Codex 작업은 기본적으로 아래 full 권한으로 실행됩니다. 신뢰하는 서버와 private Discord에서만 사용하세요.

```ini
Environment=CODEX_DISCORD_CODEX_APPROVAL_POLICY=never
Environment=CODEX_DISCORD_CODEX_SANDBOX=danger-full-access
```

권한을 낮추고 싶으면 `CODEX_DISCORD_CODEX_APPROVAL_POLICY=on-request`, `CODEX_DISCORD_CODEX_SANDBOX=workspace-write`로 바꾸세요.

connector를 Docker 안에서 돌린다면 host에서 GPU가 보여도 container에 자동으로 전달되지 않습니다. NVIDIA Container Toolkit을 설치하고 `docker run --gpus all ...` 또는 compose의 GPU device 설정으로 `/dev/nvidia*`를 container 안에 노출해야 합니다.

재시작:

```bash
sudo systemctl restart codex-discord-connector
```

## 업데이트

Ubuntu 서버에서 connector 코드를 업데이트할 때:

```bash
cd "$HOME/Codes/Codex_discord"
git pull --ff-only
pnpm install
pnpm typecheck
sudo systemctl restart codex-discord-connector
```

Discord에서도 Ubuntu admin channel에서 아래 명령을 사용할 수 있습니다.

```text
reload restart confirm
```

단, 같은 bot token을 여러 서버가 공유 중이면 반드시 Ubuntu 전용 admin channel에서 실행하세요.

## 알림 동작

- connector는 `--codex-home`에 지정한 Codex native session log를 폴링합니다.
- 처음 시작할 때 이미 완료돼 있던 작업은 기준점만 잡고 알림을 보내지 않습니다.
- 이후 새 `작업 완료` 이벤트가 생기면 Discord에 한 번만 알립니다.
- 가능한 경우 세션별 Discord thread를 만들고 operator role을 멘션합니다.
- Discord에서 직접 보낸 Codex 요청의 답변은 이미 결과 메시지로 오므로, 해당 완료 알림 한 번만 답변 preview를 생략합니다.
- SSH IDE나 서버 터미널에서 끝난 작업은 Discord에 최종 답변 preview를 포함해 알립니다.

## 보안 메모

이 connector는 해당 서버에서 shell command를 실행할 수 있는 bot입니다.

- private Discord 서버에서만 사용하세요.
- operator role을 최소 인원에게만 주세요.
- Ubuntu admin channel을 private으로 유지하세요.
- 같은 bot token을 여러 서버에서 공유한다면 channel id를 절대 겹치게 설정하지 마세요.
- `.env`, `.connect/config.json`, `.connect/state.json`은 commit하지 마세요.

## 문제 해결

### Discord 알림이 안 옴

1. 서비스 로그를 봅니다.

```bash
journalctl -u codex-discord-connector -n 200 --no-pager
```

2. connector가 보는 Codex home이 맞는지 확인합니다.

```bash
cat .connect/config.json | grep codexHome
ls -la "$HOME/.codex/sessions"
```

3. Codex를 실행한 user와 systemd `User=`가 같은지 확인합니다.

```bash
whoami
systemctl cat codex-discord-connector
```

### Mac과 Ubuntu가 둘 다 답변함

두 connector가 같은 Discord channel을 관리하고 있을 가능성이 큽니다.

- Mac admin channel id와 Ubuntu admin channel id가 다른지 확인합니다.
- `.connect/config.json`의 `direct.channelId`를 확인합니다.
- 서로 다른 channel로 바꾼 뒤 service를 재시작합니다.

```bash
cat .connect/config.json | grep channelId
sudo systemctl restart codex-discord-connector
```

### SSH IDE Codex가 다른 위치에 기록됨

IDE가 container, root user, 다른 Linux user에서 Codex를 실행하면 `$HOME/.codex`가 달라질 수 있습니다.

- connector를 Codex가 실제로 실행되는 user로 돌리거나
- `--codex-home`을 실제 Codex home으로 다시 설정하세요.
