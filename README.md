# BYROBOT Multi-Controller Diagnostics

바이로봇 USB 조종기의 실제 입력을 웹브라우저에서 안정적으로 확인하기 위한 하드웨어 입력 계층입니다. 이 단계는 미래도시 3D 시뮬레이터나 드론 게임을 구현하지 않습니다.

현재 목표는 다음 파이프라인을 검증하는 것입니다.

```text
Physical USB Controller
  → Connection Layer
  → Protocol Detector
  → BYROBOT Packet Parser
  → Product-specific ControllerAdapter
  → Common ControllerState
  → (future) Drone Simulator
```

장치를 선택한 것, 포트를 연 것, RAW 데이터를 받은 것, 패킷을 검증한 것, 실제 조종 입력이 바뀐 것을 각각 별도 상태로 표시합니다. 공식 Coding/E-Drone 계열의 `Joystick(0x71)` 8바이트와 `Button(0x70)` 3바이트 구조를 엄격한 길이 검사 뒤 해석하지만, 제품별 비행축 배정이 확인되지 않았다면 `throttle`, `yaw`, `pitch`, `roll`은 `0`이 아니라 `null`입니다.

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
- calibration의 네 의미 축이 사용자 배정까지 완료된 뒤에만 Common ControllerState가 `mapped`이고 READY

## 8. 진단 단계의 의미

| 단계 | PASS 조건 |
| --- | --- |
| DEVICE DETECTED | Serial 포트를 선택했거나 Gamepad 객체를 감지 |
| TRANSPORT OPEN | Serial `port.open()` 성공. Gamepad는 N/A |
| DATA RECEIVED | Serial에서 실제 1 byte 이상 수신 또는 Gamepad snapshot 수신 |
| PACKET PARSED | 완전한 BYROBOT profile frame의 length와 CRC 통과. Gamepad는 N/A |
| CONTROLLER INPUT ACTIVE | 검증된 adapter가 실제 축 delta 또는 버튼 edge를 확인 |

Serial의 `CONTROLLER INPUT ACTIVE`는 CRC-valid 0x71의 실제 stick 변화와 공식 0x70의 버튼 상호작용이 모두 확인된 경우에만 PASS입니다. 이 증거는 연결 세션 동안 유지되고 재연결 시 초기화됩니다. READY는 여기에 네 의미 축의 사용자/제품 매핑까지 완성된 경우에만 표시합니다.

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

Left X→Yaw 같은 기본 배정은 코드에 없습니다. `min < center < max`가 확보되지 않으면 normalized value도 만들지 않습니다.

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
│  └─ data-type-monitor.ts           # CRC-valid DataType별 최근 5초/누적 집계
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
```

UI는 `src/components/controller-diagnostics.tsx`, Web Serial 연결/RAW 처리 핵심은 `src/controllers/adapters/byrobot-serial-base.ts`, 순수 stream parser는 `src/controllers/protocols/byrobot/parser.ts`에 있습니다.

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

### 아직 실제 장치 검증 전

- 현재 사용 중인 Smart Controller의 정확한 USB descriptor와 Information modelNumber
- 사용자가 지칭한 PRC-95의 공식 제품 식별과 protocol
- BYROBOT Battle Drone Controller의 실제 USB capture가 Coding/E-Drone 8/3-byte profile과 일치하는지
- 각 제품의 throttle/yaw/pitch/roll 의미 채널 배정

Smart/PRC-95/Battle 제품 placeholder는 기본적으로 RAW-only codec과 Request 비활성 정책을 사용합니다. 실제 모델/캡처 근거가 확보되기 전에는 Coding/E-Drone layout을 자동 상속하지 않습니다. 현재 진단 화면의 Generic adapter만 주소 `Controller(0x20) → Base(0x70)`, 8/3-byte 길이, 축 범위를 모두 검증하는 Coding/E-Drone 공식 profile 후보를 명시적으로 사용합니다.

공식 Coding Drone 정의의 `0x00032004 = Battle Drone Controller USB`는 match 근거로만 준비되어 있으며, 실제 Information 응답을 받기 전에는 Battle Drone 모델로 확정하지 않습니다. PRC-95를 공식 제품명 `BATTLE DRONE (BRB-95)`와 같은 제품이라고 가정하지 않습니다.

이 개발 환경에는 실제 조종기가 연결되어 있지 않으므로 연결 성공, RAW 수신 성공, 입력 성공을 주장하지 않습니다.

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

## 18. 다음 단계로 넘어가는 정확한 성공 조건

“가상 드론 움직이기” 단계는 아래가 모두 충족된 뒤 시작합니다.

1. 실제 대상 조종기에서 안정적으로 포트를 열 수 있음
2. Ping 또는 공식 handshake 뒤 RAW가 지속 수신됨
3. DATA TYPE MONITOR에서 0x71/0x70이 독립적으로 식별됨
4. 선택된 제품 adapter의 공식/실측 Joystick layout이 검증되고 네 raw stick 값이 실시간 변화함(Coding/E-Drone profile은 0x71 8-byte)
5. 선택된 제품 adapter의 공식/실측 Button layout과 value/event 변화가 검증됨(Coding/E-Drone profile은 0x70 3-byte)
6. packet length와 CRC가 안정적으로 검증됨
7. 제품 모델을 공식 Information/model evidence로 식별하거나 명시적 사용자 profile로 선택함
8. 네 physical channel을 raw axis로 검증함
9. center/min/max/inversion/dead-zone calibration이 완료됨
10. throttle/yaw/pitch/roll이 `-1.0…+1.0`으로 안정적으로 변함
11. 중립에서 값이 dead zone 안에 있고 축 간 간섭이 없음
12. 버튼 edge가 누름/해제 모두 안정적으로 감지됨
13. `CONTROLLER INPUT ACTIVE`와 READY가 실제 동작 후에만 PASS가 됨

그때 Three.js/React Three Fiber 쪽은 `ControllerState`만 받아 비행 물리에 연결합니다.

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
