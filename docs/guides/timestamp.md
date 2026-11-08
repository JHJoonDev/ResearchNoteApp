# 시점인증(TSA) 어댑터 설정 가이드

본 문서는 LabHub 전자연구노트의 신뢰성 검증 및 장기 보존을 위한 시점인증(TSA: Time Stamping Authority) 연동 가이드입니다.

> [!NOTE]
> 시점인증(TSA) 연동은 기본적으로 선택 사항(Optional)이며 비활성화(`TIMESTAMP_PROVIDER=none`)되어 있습니다. 시점인증이 비활성화된 상태에서도 LabHub 내부의 Ed25519 전자서명과 매니페스트 봉인은 정상 수행됩니다. 연구기관의 보안 및 규정 정책에 따라 공인 RFC 3161 TSA 서비스 연동 또는 국가 전자연구노트 포털 연동을 선택하여 활성화할 수 있습니다.

---

## 1. 시점인증 개요 및 아키텍처

LabHub에서 연구노트가 최종 승인(점검자 서명)되면 다음 절차로 봉인(Seal)이 생성됩니다:
1. **매니페스트 생성**: RFC 8785(JCS) 표준에 따라 작성자/점검자 정보, 본문, 시약 사용 내역, 첨부파일 해시를 정규화하여 `manifestSha256` 산출.
2. **봉인 해시(`sealHash`) 계산**: `{ manifestSha256, pdfSha256, signatures }`를 정규화한 SHA-256 해시를 생성.
3. **시점인증 요청**: 시점인증의 대상은 바로 이 `sealHash`입니다.
4. **비동기 격리**: 외부 TSA 네트워크 호출 지연이나 일시적 장애가 연구노트 승인 트랜잭션을 차단하지 않도록, 시점인증은 백그라운드 재시도 워커(지수 백오프, 원자적 점유)를 통해 비동기로 처리됩니다.
5. **지위 및 효력**: 앱 자체는 시점인증 기관이 아니며, 시점정보의 법적/공식적 신뢰성은 연동된 외부 TSA 서비스(또는 정부 연계 센터)의 계약 및 지위에 따릅니다.

---

## 2. 지원 공급자(Provider) 유형

환경변수 `TIMESTAMP_PROVIDER` 값으로 공급자를 선택합니다.

| 공급자 코드 | 설명 | 용도 |
|---|---|---|
| `none` (기본값) | 시점인증을 요청하지 않음 (`not_configured`). 전자서명 및 봉인 자체는 진행됨. | 로컬 테스트, 시점인증 계약 이전 |
| `rfc3161` | 민간 상용 TSA 또는 표준 RFC 3161 TSP 서비스 연동 | 민간 기업, 일반 연구소, 대학 (표준 RFC 3161 연동 지원) |
| `enote-portal` | 국가R&D 전자연구노트 포털 연계 | 국가R&D 수행 연구기관 전용 (연계 명세 대기) |
| `dev-local` | 자체 로컬 서명 키로 가짜 토큰 발행 (`isTrusted: false`) | 단위/통합 테스트 전용 (`NODE_ENV=production` 차단) |

---

## 3. 민간 상용 TSA (RFC 3161) 설정

국제 표준 RFC 3161(Time-Stamp Protocol, TSP)을 준수하는 외부 시점확인 서비스와 연동할 때 사용합니다.

### 3.1 환경변수 설정 (`deploy/.env`)
```bash
TIMESTAMP_PROVIDER=rfc3161

# TSA 서비스 엔드포인트 URL
TSA_URL=https://tsa.example.org/timestamp

# (선택) HTTP Basic 인증이 필요한 경우
TSA_USERNAME=your_username
TSA_PASSWORD=your_secure_password

# (권장) TSA 루트/중간 CA 인증서 파일 경로 (PEM 형식)
# 컨테이너 내부에 마운트된 파일 경로를 지정합니다.
TSA_CA_CERT=/app/certs/tsa-ca.pem

# (선택) TSA 정책 OID
TSA_POLICY_OID=1.2.3.4.5.6.7
```

### 3.2 CA 인증서 마운트 방법
`deploy/docker-compose.yml`의 `app` 서비스 volumes에 인증서 경로를 추가합니다:
```yaml
volumes:
  - ./certs/tsa-ca.pem:/app/certs/tsa-ca.pem:ro
```

### 3.3 검증 동작
- LabHub는 SHA-256 해시, nonce(난수), certReq=true를 포함한 `TimeStampReq` 바이너리를 생성하여 `application/timestamp-query` 헤더로 TSA에 전송합니다.
- 응답(`TimeStampResp`) 수신 시 PKIStatus, messageImprint, nonce 일치 여부를 검증합니다.
- `TSA_CA_CERT`가 지정된 경우, X.509 인증서 체인 및 CMS 서명 유효성을 자체 검증하여 변조된 응답을 차단합니다.

---

## 4. 국가R&D 전자연구노트 포털 연계 (`enote-portal`)

한국특허전략개발원(연구노트확산지원본부)에서 운영하는 전자연구노트 포털(e-note.or.kr)과의 연계 방식입니다.

> [!IMPORTANT]
> **대상 기관 제한 및 신청 안내**:
> - 연구노트 포털 시점인증 서비스는 **국가연구개발사업을 수행하는 연구기관**을 대상으로 합니다.
> - 포털 안내에 따르면 시점인증 흐름은 **[연구자 작성·서명 → 확인자 점검·서명 → 해시를 연계서버로 전송 → 행정안전부 전자문서진본확인센터 → 시점정보 수신]** 구조로 동작합니다.
> - 연구노트 포털은 사전 등록된 기관에만 연계 사양 및 인증키를 발급하므로, **기관 신청 후 공식 연계 명세를 수령해야 최종 연동 구현이 완성**됩니다.

### 4.1 신청 안내
- **안내 페이지 URL**: [한국특허전략개발원 연구노트 포털 시점인증 서비스 안내](https://www.e-note.or.kr/enote/timestamp/serviceGuide.do)
- 주관 기관: 한국특허전략개발원(연구노트확산지원본부)

### 4.2 설정 키 예시
현재 어댑터 골격이 준비되어 있으며, 포털 연계 명세 수령 후 발급받은 파라미터를 주입합니다:
```bash
TIMESTAMP_PROVIDER=enote-portal
ENOTE_CLIENT_ID=YOUR_CLIENT_ID
ENOTE_CLIENT_SECRET=YOUR_CLIENT_SECRET
ENOTE_ENDPOINT=https://endpoint-from-portal-specification
```

> [!NOTE]
> 포털 공식 연계 명세가 확정되기 전까지 호출 시 시스템은 `not_configured` 상태와 함께 `"기관 신청 후 연계 명세가 필요합니다"` 안내 메시지를 반환합니다. 임의의 전문 형식을 추정하여 구현하지 않습니다.

---

## 5. 장애 대응 및 수동 재요청

- TSA 서버 일시 장애 시 해당 노트의 시점인증 상태는 `pending`으로 유지되며 승인 자체는 성공합니다.
- 점검자 자격을 가진 사용자는 노트 상세 화면의 "봉인·증빙" 패널 또는 아래 API를 통해 언제든지 시점인증을 재시도할 수 있습니다:
```bash
POST /api/eln/:id/seal/timestamp/retry
```
- 화면 및 검증 리포트에는 **서버 등록 일시**와 **시점인증 일시(`genTime`)**가 명확히 분리되어 표시됩니다.
