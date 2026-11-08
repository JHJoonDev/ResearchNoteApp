# LabHub Instrument Agent (`@labhub/instrument-agent`)

연구실 분석 장비 PC(HPLC, GC-MS, 분광기 등)에서 측정 데이터 파일의 생성을 주기적으로 감시하고, 완결된 파일을 LabHub 서버로 안전하게 스트리밍 업로드하는 경량 Node.js 24 에이전트 CLI입니다.

> [!IMPORTANT]
> **서버 수신 엔드포인트(`POST /api/v1/inbox/files`) 안내**  
> 본 에이전트가 연동하는 LabHub 서버 수신 엔드포인트는 **Phase 3**에 구현되어 배포될 예정입니다.  
> 현재 단계에서는 내장된 가상 HTTP 서버(FakeServer) 및 단위/통합 테스트를 통해 서버 규약과의 완벽한 호환성을 검증하였습니다.

---

## 1. 주요 특징 및 안전 원칙

- **외부 런타임 의존성 0개 (Zero Dependencies)**: Node.js 24 내장 모듈(`node:http`, `node:https`, `node:crypto`, `node:fs`, `node:stream`, `node:test`)만으로 동작하며 공급망 보안 위험을 원천 차단합니다.
- **원본 파일 무결성 및 불변성 절대 보장**: 원본 데이터 파일은 항상 읽기 전용(`flags: 'r'`)으로만 열리며, 절대 수정·이동·이름 변경·삭제되지 않습니다.
- **스트리밍 업로드**: 아무리 큰 파일(예: 수백 MB~GB 단위 원시 데이터)도 메모리에 전체 버퍼링하지 않고 청크 단위 스트림(`highWaterMark: 64KB`)으로 전송하여 프로세스 메모리 사용량을 최소화합니다.
- **신뢰할 수 있는 안정성 판정(`stableSec`)**: 네트워크 드라이브(SMB/NFS) 환경에서 파일 시스템 이벤트 누락 문제를 고려하여 주기적 디렉토리 스캔을 기본 진실 공급원(Source of Truth)으로 삼으며, 지정된 시간(`stableSec`) 동안 크기와 수정시각(`mtime`)이 변하지 않고 배타적 쓰기 잠금이 해제된 파일만 업로드합니다.
- **철저한 보안**: API 키는 오직 환경 변수(`LABHUB_API_KEY`) 또는 읽기 전용 키 파일(`apiKeyFile`)을 통해서만 주입받으며, 로그나 디스크 상태 파일에 절대 평문으로 노출되지 않고 마스킹(`[REDACTED_API_KEY]`)됩니다. 또한 루프백(`localhost`, `127.0.0.1`)을 제외한 원격 서버는 반드시 `https://` 프로토콜만 허용합니다.
- **원자적 상태 관리 및 복구**: 상태 파일은 임시 파일 작성 후 `fsync` 및 `rename`을 통한 원자적(atomic) 쓰기로 보장되며, 비정상 종료 시에도 손상된 상태는 백업본(`.corrupt.<timestamp>`)으로 보존하고 안전하게 복구합니다.

---

## 2. 요구 사항 및 설치

- **Node.js**: v24.0.0 이상 필요

### 프로젝트 내 빌드 및 검증
```powershell
cd tools/instrument-agent
npm test
npm audit
```

전역 명령어로 링크하여 사용할 경우:
```powershell
cd tools/instrument-agent
npm link
```

---

## 3. 설정 파일 (`config.json`)

에이전트는 JSON 설정 파일을 통해 구동됩니다.

### 설정 예시 (`config.json`)
```json
{
  "serverUrl": "https://labhub.example.org",
  "instrumentId": "HPLC-AGILENT-1260",
  "apiKeyFile": "C:\\LabHub\\secrets\\agent-key.txt",
  "watch": [
    {
      "path": "D:\\InstrumentData\\Output",
      "include": ["*.raw", "*.csv", "reports/**/*.pdf"],
      "exclude": ["*.tmp", "**/temp/**"]
    }
  ],
  "scanIntervalSec": 10,
  "stableSec": 5,
  "maxFileSizeMb": 500,
  "concurrency": 2,
  "stateDir": "C:\\ProgramData\\LabHubAgent\\state"
}
```

### 설정 항목 설명
| 항목 | 타입 | 필수 여부 | 기본값 | 설명 |
|---|---|---|---|---|
| `serverUrl` | `string` | **필수** | - | LabHub 서버 URL. 로컬호스트가 아닌 경우 반드시 `https://`여야 합니다. |
| `instrumentId` | `string` | **필수** | - | 분석 장비 식별자 (예: `HPLC-AGILENT-1260`) |
| `apiKeyFile` | `string` | 선택 | - | API 키가 저장된 파일 경로 (환경 변수 `LABHUB_API_KEY`가 없을 때 사용) |
| `watch` | `Array<{path, include, exclude}>` | **필수** | - | 감시할 디렉토리 목록 및 glob 패턴 |
| `scanIntervalSec` | `number` | 선택 | `10` | 디렉토리 재스캔 주기 (초) |
| `stableSec` | `number` | 선택 | `10` | 파일 쓰기 완료 판정을 위한 최소 불변 유지 시간 (초) |
| `maxFileSizeMb` | `number` | 선택 | `1024` | 업로드 대상 파일의 최대 허용 크기 (MB) |
| `concurrency` | `number` | 선택 | `2` | 동시 업로드 파일 수 제한 |
| `stateDir` | `string` | 선택 | `./.labhub-agent-state` | 전송 상태 및 재시도 메타데이터 저장 경로 |

### API 키 설정 방법 (권장)
보안을 위해 설정 파일 본문에 API 키를 직접 작성할 수 없도록 설계되어 있습니다. 다음 두 가지 방법 중 하나를 사용하십시오.

1. **환경 변수 사용 (권장)**:
   ```powershell
   $env:LABHUB_API_KEY = "your-secure-agent-api-key"
   ```
2. **별도 키 파일 지정**:
   `C:\LabHub\secrets\agent-key.txt` 파일에 키를 저장하고 파일 권한을 에이전트 실행 계정 전용으로 설정한 후 `apiKeyFile`에 경로를 지정합니다.

---

## 4. 실행 방법

### 데몬(상주) 모드
주기적으로 감시 디렉토리를 스캔하고 대기 큐를 처리합니다. `Ctrl+C` (SIGINT) 또는 SIGTERM 시 진행 중인 업로드를 안전하게 마치고 상태를 디스크에 플러시한 뒤 종료됩니다.
```powershell
node bin/labhub-agent.js --config config.json
```

### 1회 실행 (`--once`) 모드
전체 감시 폴더를 1회 스캔하고 완료된 파일들을 업로드한 뒤 즉시 종료합니다. 영구 실패(400, 413, 415 등)가 발생한 파일이 있는 경우 비정상 종료 코드(`1`)를 반환합니다.
```powershell
node bin/labhub-agent.js --config config.json --once
```

### 전송 상태 요약 조회 (`--status`)
현재 디스크에 기록된 파일 전송 상태(완료, 대기, 실패, 인증 일시중지 여부 등)를 JSON 요약으로 출력합니다.
```powershell
node bin/labhub-agent.js --config config.json --status
```

---

## 5. Windows 운영 환경 등록 가이드

분석 장비 PC는 통상 Windows 10/11 또는 Windows Server 환경에서 구동됩니다. 장비 PC 부팅 시 자동 실행되도록 아래 두 가지 방식 중 하나를 적용할 수 있습니다.

### 방법 A: Windows 작업 스케줄러 등록 (추천 - 간편 설정)

시스템 부팅 시 또는 사용자 로그인 시 백그라운드에서 상주하도록 작업 스케줄러에 등록합니다.

PowerShell(관리자 권한)에서 다음 명령어로 작업을 등록할 수 있습니다:

```powershell
# 1. 작업 등록 변수 설정
$TaskName = "LabHubInstrumentAgent"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$AgentScript = "C:\LabHub\tools\instrument-agent\bin\labhub-agent.js"
$ConfigFile = "C:\LabHub\config.json"
$Arguments = "`"$AgentScript`" --config `"$ConfigFile`""

# 2. 작업 스케줄러 등록 (시스템 시작 시 자동 실행, 네트워크 연결 시)
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument $Arguments -WorkingDirectory "C:\LabHub\tools\instrument-agent"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings
```

### 방법 B: Windows 서비스로 등록 (NSSM 활용)

[NSSM (Non-Sucking Service Manager)](https://nssm.cc/)을 사용하면 완전한 Windows 서비스로 등록하여 프로세스 크래시 시 자동 재시작 및 윈도우 이벤트 로그 관리가 가능합니다.

```powershell
# 1. 서비스 등록
nssm install LabHubAgent "C:\Program Files\nodejs\node.exe" "C:\LabHub\tools\instrument-agent\bin\labhub-agent.js --config C:\LabHub\config.json"

# 2. 환경 변수 주입 (API 키)
nssm set LabHubAgent AppEnvironmentExtra LABHUB_API_KEY=your-secure-agent-api-key

# 3. 서비스 시작 및 상태 확인
nssm start LabHubAgent
nssm status LabHubAgent
```

---

## 6. 서버 응답별 에이전트 동작 규약

| 응답 코드 | 서버 상태 | 에이전트 동작 |
|---|---|---|
| `201 Created` | 파일 저장 완료 | 상태 파일에 `uploaded`로 기록 |
| `200 OK` (`duplicate: true`) | 이미 동일 파일 저장됨 | 상태 파일에 `uploaded`로 기록 |
| `400`, `413`, `415` | 요청 형식 위반, 크기 초과, 미지원 확장자 | 영구 실패(`permanentlyFailed: true`)로 기록하고 다음 파일 처리 지속 |
| `422 Unprocessable` | 파일 체크섬 불일치 | 즉시 1회 재해싱 후 재업로드 시도, 재차 실패 시 영구 실패 처리 |
| `401`, `403` | 인증 키 만료 또는 권한 없음 | 모든 업로드 즉시 일시 중단(`paused`), 로그 경고, 설정 주기마다 재확인 |
| `408`, `429`, `5xx`, 네트워크 오류 | 서버 부하 또는 일시적 통신 오류 | 지수 백오프 및 무작위 지터(Jitter) 적용 후 재시도. `Retry-After` 헤더 수신 시 우선 준수 |
