# 바이로봇 조종기 진단 + 가상 드론 1차 시뮬레이터

바이로봇 USB 조종기의 실제 입력을 웹브라우저에서 안정적으로 확인하고, 검증된 `Common ControllerState`로 테스트 격자 위의 가상 드론 한 대를 움직이는 프로젝트입니다. 아직 미래도시, 건물, 장애물, 미션, 점수 시스템은 구현하지 않습니다.

현재 목표는 다음 파이프라인을 검증하는 것입니다.

```text
Physical USB Controller
  → Connection Layer
  → Protocol Detector
  → BYROBOT Packet Parser
  → Product-specific ControllerAdapter
  → Common ControllerState
  → Flight Model
  → Virtual Drone Test Canvas
```

장치를 선택한 것, 포트를 연 것, RAW 데이터를 받은 것, 패킷을 검증한 것, 실제 조종 입력이 바뀐 것을 각각 별도 상태로 표시합니다. 공식 Coding/E-Drone 계열의 `Joystick(0x71)` 8바이트와 `Button(0x70)` 3바이트 구조를 엄격한 길이 검사 뒤 해석하지만, 제품별 비행축 배정이 확인되지 않았다면 `throttle`, `yaw`, `pitch`, `roll`은 `0`이 아니라 `null`입니다.

## 0. 기본 화면과 가상 드론 사용법

첫 화면은 일반 사용자를 위한 한글 UI입니다.

- 왼쪽: USB 연결, 스틱 입력, 버튼 입력, 현재 준비 상태
- 가운데: 밝은 테스트 격자와 가상 드론 한 대
- 오른쪽: 왼쪽/오른쪽 스틱의 상하·좌우 숫자와 게이지, 최근 누른 버튼
- 아래: **이륙**, **착륙**, **위치 초기화**, **긴급 정지**, 조종기 버튼 설정
- 기술 정보: **개발자 정보 보기**를 펼치면 기존 Serial/RAW/DataType/packet/CRC/calibration 화면이 그대로 표시됨

확인된 0x71 stick 순서 `[Left X, Left Y, Right X, Right Y]`에는 다음 기본 의미 배치를 적용합니다.

```text
Left Y  → Throttle → 상승/하강
Left X  → Yaw      → 좌우 회전
Right Y → Pitch    → 전진/후진
Right X → Roll     → 좌우 이동
```

기본 dead zone은 `0.10`입니다. 절댓값이 `0.10`보다 작은 흔들림은 0으로 처리하고, 지수 smoothing과 속도 응답 smoothing으로 가속·감속을 부드럽게 합니다. 조종기 연결이 끊기거나 READY 조건을 잃거나 최신 stick 입력이 500ms 이상 멈추면 잔류 속도·회전 입력을 즉시 중립화합니다. 탭이 백그라운드로 가도 motion을 중립화하고 복귀 시 큰 frame delta를 적용하지 않습니다.

화면 버튼은 조종기 연결 전에도 마우스로 시험할 수 있습니다. 조종기 버튼은 기능에 하드코딩하지 않습니다. 조종기를 연결한 뒤 각 **설정** 버튼을 누르고 실제 버튼 하나를 누르면 이륙/착륙/긴급 정지에 연결됩니다. 설정 중 누른 버튼은 즉시 비행 명령으로 실행되지 않으며, 같은 버튼을 다른 기능에 지정하면 이전 지정은 해제됩니다. 설정은 브라우저 `localStorage`에 컨트롤러 출처별로 저장됩니다.

## 1. 실행 방법

Node.js 22.13 이상을 권장합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

검증 명령:

```bash
npm test
npm run lint
npm run build
```

## 2. 권장 브라우저와 보안 환경

- Windows 노트북 + 최신 Google Chrome 권장
- Web Serial은 HTTPS 또는 `localhost`에서만 사용
- Vercel 배포 주소는 HTTPS이므로 사용자 클릭 후 `navigator.serial.requestPort()` 사용 가능
- Firefox와 Safari는 Web Serial을 지원하지 않을 수 있음
- 하드웨어 API는 `"use client"` 컴포넌트에서만 접근하며 SSR 중에는 `navigator`를 읽지 않음

## 3. 바이로봇 조종기 LINK 모드 확인

1. 조종기 전원을 끕니다.
2. 제품 설명서에 맞는 USB 케이블로 PC에 연결합니다.
3. 조종기 화면에 `LINK`가 표시되는지 확인합니다.
4. Windows 장치 관리자에서 새 COM 포트가 생기는지 확인합니다.
5. 다른 시리얼 프로그램이나 BYROBOT 업데이트 프로그램이 같은 COM 포트를 열고 있다면 닫습니다.

`LINK` 표시는 조종기가 USB Link 모드에 들어갔다는 뜻이지, 웹페이지가 실제 조종 입력을 수신했다는 뜻은 아닙니다.

BYROBOT 공식 Coding Drone/E-Drone 입력 예제는 포트를 연 뒤 Controller로 Ping을 보냅니다. E-Drone 펌웨어 기록에도 PC에서 데이터를 받은 뒤 조이스틱/버튼 전송을 시작한다고 명시되어 있습니다. 그래서 이 앱에는 별도의 **BYROBOT 입력 활성화 (Controller Ping)** 버튼이 있습니다.

## 4. Gamepad 테스트 방법

Gamepad API 경로는 삭제하지 않았습니다.

1. USB 조종기 또는 게임패드를 연결합니다.
2. 브라우저가 장치를 공개하도록 버튼을 한 번 누릅니다.
3. CONNECTION의 Gamepad 카드에 감지 개수가 증가하는지 확인합니다.
4. Gamepad 선택 목록에서 장치를 고릅니다.
5. `Gamepad 실시간 축·버튼·RAW 정보`에서 다음을 확인합니다.
   - 전체 `navigator.getGamepads()` 축
   - 전체 버튼의 `pressed`, `value`
   - gamepad ID, index, mapping, timestamp
6. 축 또는 버튼이 실제로 변하면 `CONTROLLER INPUT ACTIVE`가 PASS로 바뀝니다.

Gamepad raw axis를 의미 축으로 고정하지 않았습니다. 캘리브레이션 후 사용자가 각 axis를 Throttle/Yaw/Pitch/Roll에 직접 배정해야 Common ControllerState가 완성됩니다.

## 5. Serial 테스트 방법

현재 스마트 조종기의 1차 테스트 순서입니다.

1. Chrome에서 배포 주소 또는 localhost를 엽니다.
2. **Serial 장치 선택**을 누릅니다.
3. LINK 모드 조종기에 해당하는 COM 포트를 선택합니다.
4. Vendor ID와 Product ID가 DEVICE INFORMATION에 표시되는지 확인합니다.
5. baud rate를 선택합니다.
   - UI 기본값: **115200** (요청 사항)
   - Coding Drone / E-Drone / Battle Drone 공식 문서값: **57600, 8N1, no parity**
   - 9600은 수동 진단 옵션이며 이 세 제품 계열의 공식값으로 확인된 것은 아닙니다.
6. **Serial 연결**을 누릅니다.
7. `SERIAL OPEN`이 PASS인지 확인합니다.
8. **BYROBOT 입력 활성화 (Controller Ping)**을 누릅니다.
9. DATA TYPE MONITOR에서 최근 5초 `0x71 JOYSTICK`, `0x70 BUTTON` count를 확인합니다.
10. 좌·우 스틱을 하나씩 움직여 0x71 payload와 Left X/Y, Right X/Y가 변하는지 확인합니다.
11. 버튼을 하나씩 눌러 0x70 button value, bitmask, event가 변하는지 확인합니다.
12. Ping 뒤 2초 이상 0x71이 전혀 없다면 **0x71 / 0x70 Request 1회**를 누릅니다.
13. 1회 Request에서만 snapshot이 오고 지속 변화가 안 보이면 **Request 폴링 시작**을 눌러 진단합니다.

앱이 보내는 활성화 프레임은 공식 Base(`0x70`) → Controller(`0x20`) Ping 구조에서 만든 다음 값입니다.

```text
0A 55 01 08 70 20 00 00 00 00 00 00 00 00 86 D9
```

비행/모터 명령은 보내지 않습니다.

Request fallback도 공식 `Protocol::Request` 구조만 사용합니다.

```text
Joystick Request: 0A 55 04 01 70 20 71 EA 4F
Button Request:   0A 55 04 01 70 20 70 CB 5F
```

공식 입력 예제의 우선 경로는 Controller Ping 뒤 push 입력을 기다리는 방식입니다. 공식 문서에는 Joystick polling 권장 주기가 없으므로 앱의 250ms 간격은 사용자가 명시적으로 켜는 보수적 진단 설정이며 공식 권장값으로 표시하지 않습니다.

## 6. RAW 데이터 확인 방법

RAW SERIAL MONITOR는 브라우저의 각 수신 단위를 가공 전에 저장합니다.

- timestamp (밀리초 포함)
- byte length
- HEX
- DECIMAL
- 최근 100개 수신 단위
- 총 수신 bytes
- 최근 1초 bytes/sec
- 최근 수신 시각
- 수신 단위 수

버튼:

- **로그 지우기**: 화면 로그만 삭제하고 세션 총 byte 통계는 유지
- **일시정지**: 화면 로그 추가만 멈추며 reader, parser, 통계는 계속 동작
- **복사**: timestamp, length, HEX, DECIMAL을 함께 클립보드로 복사

`Data changing`은 최근 수신 단위 또는 CRC-valid packet 내용을 비교하는 관찰용 휴리스틱입니다.

- `INSUFFICIENT`: 비교할 표본이 부족함
- `NO`: 최근 비교 가능한 표본이 같음
- `YES`: 최근 표본 내용이 달라짐

시리얼 read chunk 경계나 패킷 안의 시간/카운터만 달라져도 YES가 될 수 있으므로, 이 값만으로 `CONTROLLER INPUT ACTIVE`나 READY를 판정하지 않습니다.

### DATA TYPE MONITOR

- 기존 parser가 CRC-valid로 확정한 모든 packet을 DataType별로 집계
- 최근 5초 count와 세션 total을 분리
- 같은 DataType의 최근 payload끼리만 변화 여부 비교
- `0x71 JOYSTICK`, `0x70 BUTTON`은 0건이어도 고정 표시
- 최근 5초 표본이 2개 미만이면 `INSUFFICIENT`, 같으면 `NO`, 다르면 `YES`

### 공식 Controller input decode

```text
0x71 · 8 bytes
left.x(s8), left.y(s8), left.direction(u8), left.event(u8),
right.x(s8), right.y(s8), right.direction(u8), right.event(u8)

0x70 · 3 bytes
button(u16 little-endian), event(u8)
```

Joystick 축은 문서 범위 `-100…+100`일 때만 `rawAxes`의 `[Left X, Left Y, Right X, Right Y]` 순서로 `-1…+1` 정규화합니다. payload 길이가 다르거나 범위 밖이면 RAW와 오류 이유만 표시하고 ControllerState에는 반영하지 않습니다. 이는 구형 Drone Fighter처럼 같은 DataType에 다른 payload 구조를 쓰는 제품을 잘못 해석하지 않기 위한 조치입니다.

## 7. 어떤 결과가 나오면 1차 성공인가

스마트 조종기 스틱 조작 전/후에 다음이 보여야 합니다.

```text
Device detected        PASS
Serial port open       PASS
Raw data received      PASS
BYROBOT packet parsed  PASS 또는 Candidate 조사 가능
Controller input       0x71 이동 + 0x70 버튼 상호작용 뒤 PASS
```

1차 RAW 수신 성공 조건:

- Ping 전송 뒤 TOTAL BYTES가 0보다 큼
- LAST RECEIVED가 갱신됨
- 스틱/버튼 조작에 따라 RAW HEX 또는 DECIMAL 내용이 달라짐
- Data changing이 조작 중 YES가 됨

BYROBOT 공통 프레임 성공 조건:

- `0A 55` 시작 코드 발견
- 완전한 length만큼 stream buffer에서 복원
- Header+Payload CRC16이 wire의 little-endian CRC와 일치
- PARSED PACKET에 DataType, Length, From, To, Payload, CRC valid가 표시

이번 입력 단계의 성공 조건:

- 최근 5초 DATA TYPE MONITOR에 `0x71 JOYSTICK` count가 증가
- 실제 stick 이동 시 0x71 payload와 Left/Right X/Y 중 해당 값이 변화
- `0x70 BUTTON` 수신 후 버튼을 누르면 bitmask/event가 변화
- 위 두 입력 증거가 같은 연결 세션에서 확인된 뒤에만 `CONTROLLER INPUT ACTIVE`가 PASS
- 검증된 0x71 8-byte profile의 기본 네 축 배치 또는 사용자가 완료한 calibration으로 Common ControllerState가 `mapped`인 상태에서만 READY

## 8. 진단 단계의 의미

| 단계 | PASS 조건 |
| --- | --- |
| DEVICE DETECTED | Serial 포트를 선택했거나 Gamepad 객체를 감지 |
| TRANSPORT OPEN | Serial `port.open()` 성공. Gamepad는 N/A |
| DATA RECEIVED | Serial에서 실제 1 byte 이상 수신 또는 Gamepad snapshot 수신 |
| PACKET PARSED | 완전한 BYROBOT profile frame의 length와 CRC 통과. Gamepad는 N/A |
| CONTROLLER INPUT ACTIVE | 검증된 adapter가 실제 축 delta 또는 버튼 edge를 확인 |

Serial의 `CONTROLLER INPUT ACTIVE`는 CRC-valid 0x71의 실제 stick 변화와 공식 0x70의 버튼 상호작용이 모두 확인된 경우에만 PASS입니다. 이 증거는 연결 세션 동안 유지되고 재연결 시 초기화됩니다. READY는 여기에 네 의미 축의 검증된 기본 profile 또는 사용자 calibration mapping까지 완성된 경우에만 표시합니다.

## 9. 오류와 확인 순서

### Web Serial 미지원

Windows Chrome, HTTPS/localhost인지 확인합니다.

### 포트 권한 거절

Serial 장치 선택을 다시 누르고 올바른 COM 포트를 허용합니다.

### COM port unavailable / already open

BYROBOT updater, Arduino Serial Monitor, 다른 브라우저 탭 등 같은 포트를 쓰는 프로그램을 닫습니다. 앱에서 연결 해제 후 다시 연결합니다.

### 데이터 수신 없음

1. LINK 표시 확인
2. BYROBOT 입력 활성화 Ping 클릭
3. 공식값 57600으로 재연결
4. 115200으로 재연결
5. 다른 데이터 지원 USB 케이블/포트 사용
6. Windows 장치 관리자에서 COM 포트와 드라이버 확인

### packet start code 없음 / baud mismatch 의심

bytes는 들어오지만 `0A 55`가 없다면 baud가 다르거나 다른 프로토콜일 수 있습니다. RAW를 저장하고 baud별로 비교합니다.

### CRC error

길이/baud/profile이 다르거나 중간부터 수신했을 수 있습니다. parser는 한 byte씩 이동해 다음 `0A 55`로 재동기화합니다.

### unsupported controller / adapter not available

RAW와 공통 프레임은 볼 수 있지만 제품별 payload mapping이 아직 없다는 뜻입니다. 모델을 추측하지 않고 아래 정보를 확보합니다.

## 10. Vendor ID / Product ID 확인 방법

### 앱에서

Serial 장치 선택 직후 `port.getInfo()`의 `usbVendorId`, `usbProductId`를 DEVICE INFORMATION에서 확인합니다. Web Serial은 일반적으로 product name이나 serial number를 제공하지 않으므로 해당 값은 Unknown일 수 있습니다.

### Windows 장치 관리자에서

1. 장치 관리자 → 포트(COM 및 LPT)
2. 해당 USB Serial 장치 → 속성
3. 자세히 → 하드웨어 ID
4. `VID_XXXX`, `PID_YYYY` 기록

USB bridge chip의 VID/PID가 같다고 조종기 제품이 같은 것은 아닙니다. VID/PID만으로 모델을 확정하지 않습니다.

## 11. RAW packet 샘플 저장 방법

1. 로그 지우기
2. 스틱/버튼을 건드리지 않은 중앙 상태 3~5초 기록
3. 복사 버튼을 눌러 텍스트 파일에 붙여넣기
4. 로그 지우기
5. Left X, Left Y, Right X, Right Y를 각각 한 축씩 최소/중앙/최대로 이동해 별도 저장
6. 버튼을 하나씩 눌러 별도 저장
7. 파일명에 모델/VID/PID/baud/동작을 기록

예:

```text
smart-controller_vid-xxxx_pid-yyyy_57600_center.txt
smart-controller_vid-xxxx_pid-yyyy_57600_left-x-min-max.txt
smart-controller_vid-xxxx_pid-yyyy_57600_button-1.txt
```

## 12. 캘리브레이션

각 raw axis에 다음을 저장합니다.

- raw current
- observed minimum
- observed maximum
- center
- normalized value
- inversion
- dead zone
- assigned control

사용 순서:

1. **캘리브레이션 시작**
2. 스틱을 놓고 **중앙 저장**
3. **범위 기록**을 켬
4. 각 스틱을 전체 범위로 천천히 움직임
5. 범위 기록을 끔
6. 실제 확인 결과에 맞춰 각 raw axis를 의미 축에 배정

엄격하게 해석된 BYROBOT 0x71 8-byte profile에는 이번 1차 시뮬레이터의 기본 배치 `Left X→Yaw`, `Left Y→Throttle`, `Right X→Roll`, `Right Y→Pitch`를 적용합니다. 사용자가 캘리브레이션과 의미 축 배정을 완료하면 사용자 설정이 기본 배치보다 우선합니다. 다른 제품 profile은 같은 채널 순서라고 가정하지 않으며, adapter가 검증한 raw axis 순서 또는 사용자 캘리브레이션이 필요합니다. `min < center < max`가 확보되지 않은 사용자 calibration 값은 정규화하지 않습니다.

## 13. ControllerAdapter 구조

```text
src/controllers/
├─ types.ts                         # ControllerState, adapter, diagnostics, errors
├─ controller-manager.ts            # registry, ranking, active adapter, READY 판정
├─ calibration.ts                   # axis 관측/중앙/범위/dead-zone/정규화
├─ connections/
│  └─ serial-connection.ts          # request 이후 open/read/write/cancel/close 수명주기
├─ diagnostics/
│  ├─ change-detector.ts            # RAW/packet 변화 휴리스틱
│  ├─ data-type-monitor.ts           # CRC-valid DataType별 최근 5초/누적 집계
│  └─ button-event-journal.ts        # 빠른 0x70 down/repeat/up edge 보존
├─ adapters/
│  ├─ gamepad-adapter.ts            # Gamepad API → raw ControllerState
│  ├─ byrobot-serial-base.ts         # Serial + parser + stats + generic fallback
│  ├─ smart-controller-adapter.ts    # 검증 전 placeholder
│  ├─ prc95-adapter.ts               # 검증 전 placeholder
│  └─ battle-drone-adapter.ts        # 공식 model number match, payload는 placeholder
└─ protocols/byrobot/
   ├─ types.ts                       # profile과 공통 packet 타입
   ├─ crc16.ts                       # polynomial 0x1021, initial 0x0000
   ├─ parser.ts                      # stream buffering, length, CRC, resync
   ├─ packet.ts                      # 공식 device-addressed Ping/Request builder
   └─ controller-input.ts            # 엄격한 0x71 Joystick / 0x70 Button codec와 evidence

src/simulator/
├─ flight-model.ts                   # dead zone, smoothing, 이륙/비행/착륙/긴급 상태기계
└─ button-mapping.ts                 # 출처별 버튼 캡처와 rising-edge 명령 매핑
```

한글 기본 UI는 `src/components/controller-simple-ui.tsx`, 가상 드론 화면은 `src/components/drone-simulator.tsx`, 전체 조립 및 개발자 진단 UI는 `src/components/controller-diagnostics.tsx`에 있습니다. Web Serial 연결/RAW 처리 핵심은 `src/controllers/adapters/byrobot-serial-base.ts`, 순수 stream parser는 `src/controllers/protocols/byrobot/parser.ts`에 있습니다. 시뮬레이터는 packet/Serial 모듈을 직접 읽지 않고 오직 `ControllerState` 안의 의미 축과 protocol-neutral `buttonTransitions`만 입력으로 받습니다. Serial과 Gamepad adapter가 같은 공통 버튼 전이 형식을 생산합니다.

## 14. BYROBOT parser에서 확인된 것

Coding Drone/E-Drone 계열 공식 구조:

```text
0A 55 | DataType Length From To | Payload | CRC low CRC high
```

- Length는 Payload 길이
- 총 frame 길이는 `8 + Length`
- CRC 범위는 Start Code와 CRC를 제외한 Header+Payload
- polynomial `0x1021`
- initial `0x0000`
- no reflection, no final XOR
- CRC wire order는 little-endian

구형 Petrone Link는 같은 `0A 55`를 사용하지만 From/To가 없는 2-byte header profile입니다. 그래서 parser는 profile을 주입할 수 있게 만들었고, 시작 코드만으로 device-addressed protocol을 확정하지 않습니다.

parser 테스트는 다음을 포함합니다.

- 공식 CRC 예제 벡터
- byte 단위 모든 chunk 경계
- leading noise와 중간 진입
- back-to-back packets
- incomplete packet buffer
- CRC 오류 뒤 다음 frame resync
- payload 안의 `0A 55`
- legacy Link profile
- 64 KiB buffer cap

## 15. 새 ControllerAdapter 추가 방법

1. 실제 제품명과 라벨 사진 확보
2. VID/PID 기록 (모델 확정 근거가 아니라 탐지 evidence)
3. 공식 baud와 8N1 설정 확인
4. 중앙/각 축/각 버튼 RAW 샘플 확보
5. valid packet의 DataType, Length, From, To 기록
6. 가능하면 공식 Information 응답의 modelNumber 확보
7. 제품 adapter의 `matches()`에서 `none / candidate / confirmed`와 evidence 반환
8. 공식 문서와 실제 capture가 일치한 payload만 `ByrobotControllerInputCodec`으로 구현해 adapter에 주입
9. 제품별 Request 가능 DataType/획득 방식을 adapter policy로 override
10. raw axis 순서를 먼저 노출하고 의미 축은 calibration/profile로 분리
11. CRC/length/축/버튼 변화 테스트 추가

제품 adapter를 추가해도 3D 시뮬레이터나 게임 코드는 수정하지 않습니다. 이후 시뮬레이터는 Common ControllerState만 구독합니다.

## 16. 현재 지원 범위

### 구현됨

- 모든 브라우저 Gamepad API 장치의 raw axes/buttons/info
- Web Serial 포트 선택, 9600/57600/115200, 8N1
- 공식 BYROBOT device-addressed frame 복원과 CRC 검증
- 같은 start code를 쓰는 legacy profile을 별도 정의할 수 있는 parser 구조
- Generic BYROBOT Serial 진단과 명시적인 Coding/E-Drone input profile 후보
- RAW 변화 관찰, 최근 100개 로그, 복사/일시정지/지우기
- 공식 Controller Ping을 통한 입력 활성화 시도
- CRC-valid DataType별 최근 5초 count와 동일 DataType payload 변화 표시
- 공식 Coding/E-Drone 8-byte Joystick과 3-byte Button strict decode
- Left X/Y, Right X/Y, direction/event, button bitmask/event 실시간 표시
- 공식 Request 1회 및 사용자 제어 진단 polling fallback
- calibration 결과를 실제 mapped Common ControllerState로 projection
- 사용자 지정 Gamepad axis calibration/mapping
- 한글 중심의 연결·입력 상태와 실시간 stick 게이지
- 기존 기술 진단 전체를 접이식 **개발자 정보 보기**로 보존
- 0x71 기본 stick 배치와 사용자 calibration override
- dead zone 0.10, frame-rate 독립 exponential smoothing, 긴 frame delta 제한
- 이륙/비행/착륙/긴급 정지 상태기계와 밝은 격자의 가상 드론 한 대
- 화면 이륙/착륙/초기화/긴급 정지 버튼
- 빠른 0x70 down→up과 같은 timestamp의 연타 순서를 보존하는 128-transition button journal
- 실제 조종기 버튼을 이륙/착륙/긴급 정지에 사용자 지정하는 source-scoped 매핑

### 아직 실제 장치 검증 전

- 현재 사용 중인 Smart Controller의 정확한 USB descriptor와 Information modelNumber
- 사용자가 지칭한 PRC-95의 공식 제품 식별과 protocol
- BYROBOT Battle Drone Controller의 실제 USB capture가 Coding/E-Drone 8/3-byte profile과 일치하는지
- PRC-95/Battle Drone 등 다른 제품 profile의 throttle/yaw/pitch/roll 의미 채널 배정

Smart/PRC-95/Battle 제품 placeholder는 기본적으로 RAW-only codec과 Request 비활성 정책을 사용합니다. 실제 모델/캡처 근거가 확보되기 전에는 Coding/E-Drone layout을 자동 상속하지 않습니다. 현재 진단 화면의 Generic adapter만 주소 `Controller(0x20) → Base(0x70)`, 8/3-byte 길이, 축 범위를 모두 검증하는 Coding/E-Drone 공식 profile 후보를 명시적으로 사용합니다.

공식 Coding Drone 정의의 `0x00032004 = Battle Drone Controller USB`는 match 근거로만 준비되어 있으며, 실제 Information 응답을 받기 전에는 Battle Drone 모델로 확정하지 않습니다. PRC-95를 공식 제품명 `BATTLE DRONE (BRB-95)`와 같은 제품이라고 가정하지 않습니다.

사용자 환경에서는 Serial, 0x71 stick, 0x70 button 감지가 확인되었다고 전달받았습니다. 이 개발 환경 자체에는 실제 조종기가 연결되어 있지 않으므로 여기서 비행 조작 성공까지 임의로 주장하지 않습니다.

## 17. 미지원 조종기 연결 시 확보할 정보

- 제조사/제품의 정확한 표기와 뒷면 라벨 사진
- Windows 장치 관리자 표시명과 COM 번호
- USB vendorId/productId
- 조종기 화면의 LINK 상태
- 사용 baud rate
- 중앙 상태 RAW 5초
- 각 stick axis 최소/중앙/최대 RAW
- 각 button OFF/ON RAW
- `0A 55` 존재 여부
- valid packet의 DataType/Length/From/To/Payload/CRC
- 동일 조작을 3회 반복한 샘플
- 펌웨어 버전 또는 Information 응답

## 18. 가상 드론 1차 실기 검증 순서와 성공 조건

1. Chrome에서 조종기를 선택하고 Serial을 연결합니다.
2. 필요하면 **입력 시작**으로 Controller Ping을 보냅니다.
3. 왼쪽/오른쪽 stick과 버튼을 움직여 기본 화면의 세 항목이 모두 `정상`, 현재 상태가 `조종 준비 완료`가 되는지 확인합니다.
4. **이륙**을 누르고 왼쪽 stick 상하로 상승/하강합니다.
5. 왼쪽 stick 좌우로 yaw, 오른쪽 상하로 전진/후진, 오른쪽 좌우로 횡이동을 각각 확인합니다.
6. 왼쪽 stick을 위로 유지하면서 아주 작은 좌우 흔들림에는 회전하지 않고, 명확한 좌우 입력에는 상승과 회전이 동시에 되는지 확인합니다.
7. 이륙/착륙/긴급 정지의 **설정**을 각각 누른 뒤 실제 조종기 버튼을 하나씩 지정합니다.
8. 지정한 버튼이 눌림 edge에서 한 번만 실행되고 길게 눌렀을 때 반복 실행되지 않는지 확인합니다.
9. 연결을 해제했을 때 드론의 수평 속도와 yaw rate가 즉시 중립화되는지 확인합니다.

이번 단계의 정확한 성공 조건:

- 0x71 입력이 네 한글 stick 게이지와 `ControllerState`에 실시간 반영됨
- 이륙 후 throttle/yaw/pitch/roll 네 축이 의도한 방향으로 드론을 움직임
- 중립 흔들림 `< 0.10`은 움직임을 만들지 않음
- 큰 입력은 부드럽게 가속되고 stick을 놓으면 부드럽게 감속함
- 0x70 버튼 매핑 세 기능이 실제 장치에서 각각 한 번씩 정확히 실행됨
- 화면의 이륙/착륙/초기화/긴급 정지도 동작함
- 기존 RAW, DataType, parsed packet, CRC, calibration 화면이 **개발자 정보 보기** 안에서 계속 동작함

위 조건을 실제 장치에서 모두 확인한 뒤에만 다음 단계인 미래도시/장애물/미션 설계로 넘어갑니다. 다음 단계도 Serial packet이 아니라 `ControllerState`만 구독해야 합니다.

## 19. 공식 참고 자료

- [Coding Drone Protocol Intro](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/01_intro/)
- [Coding Drone DataType](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/03_datatype/)
- [Coding Drone Protocol Structs](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/05_structs/)
- [Coding Drone Input Example](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/library/python/coding_drone/examples_12_input/)
- [Coding Drone Definitions](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/04_definitions/)
- [E-Drone Definitions](https://dev.byrobot.co.kr/documents/kr/products/e_drone/protocol/04_definitions/)
- [E-Drone Firmware Updates](https://dev.byrobot.co.kr/documents/kr/products/e_drone/log/updates/firmware/)
- [Battle Drone Product Page](https://dev.byrobot.co.kr/documents/kr/products/battle_drone/)
- [Legacy Petrone Link Protocol](https://dev.byrobot.co.kr/documents/kr/products/petrone/protocol/link/01_intro/)
- [Official CodingDrone CRC source](https://github.com/AluxDrone/CodingDrone/blob/master/CodingDrone/crc.py)
