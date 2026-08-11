# 바이로봇 미래항공모빌리티 운항 훈련

바이로봇 USB 조종기의 실제 입력을 웹브라우저에서 안정적으로 읽고, 검증된 `Common ControllerState`로 조종법 안내부터 기초 훈련, 자격시험, 항공모빌리티 임무까지 진행하는 교육용 시뮬레이터입니다. 기존 Web Serial, RAW monitor, BYROBOT parser, CRC, 0x71 Joystick, 0x70 Button 진단 기능은 그대로 유지합니다.

현재 구현 파이프라인은 다음과 같습니다.

```text
Physical USB Controller
  → Connection Layer
  → Protocol Detector
  → BYROBOT Packet Parser
  → Product-specific ControllerAdapter
  → Common ControllerState
  → FlightController
  → FlightPhysics (`flight-model.ts`)
      ├→ DroneTransform → DroneVisual
      └→ ExperienceCoordinator
          ├→ Tutorial / Training / Certification / Mission / Result
          └→ DroneScenePresentation → DroneVisual
```

장치를 선택한 것, 포트를 연 것, RAW 데이터를 받은 것, 패킷을 검증한 것, 실제 조종 입력이 바뀐 것을 각각 별도 상태로 표시합니다. 공식 Coding/E-Drone 계열의 `Joystick(0x71)` 8바이트와 `Button(0x70)` 3바이트 구조를 엄격한 길이 검사 뒤 해석하지만, 제품별 비행축 배정이 확인되지 않았다면 `throttle`, `yaw`, `pitch`, `roll`은 `0`이 아니라 `null`입니다. 제품 모델과 USB 버튼 값도 확인 근거 없이 추측하지 않습니다.

## 0. 학생용 체험 흐름과 기본 조종법

첫 화면은 학생과 교사를 위한 한글 중심 UI입니다.

- 상단: 조종기 연결, 현재 체험 단계, 비행 상태, 비행 속도
- 단계 안내: 조종법 안내 → 기초 조종 훈련 → 조종 자격시험 → 임무 선택 → 실제 비행 임무 → 결과
- 비행 HUD: 고도, 속도, 시간, 배터리, 현재 목표, 진행도, 충돌·강풍·저전력 경고
- 중앙: 가상 드론과 단계별 링, 착륙장, 건물, 병원, 탐색 지점, 강풍 구역
- 안전 기능: 항상 보이는 **긴급 안전 착륙**
- 비행 설정: 속도, 조종 방식, 헤드리스 모드, 자세 안정화, 중앙 무시 범위, 감도, Expo
- 기술 정보: **개발자 정보 보기**를 펼치면 기존 Serial/RAW/DataType/packet/CRC/calibration 화면이 그대로 표시됨

### 자동 연결과 자동 중앙 보정

처음 사용하는 브라우저와 배포 주소에서는 **조종기 처음 연결하기**를 한 번 눌러 Chrome의 Serial 장치 선택 창에서 포트를 승인해야 합니다. 유효한 BYROBOT 패킷을 확인한 뒤 VID/PID 식별 정보를 저장하며, 같은 origin에서 다음 접속부터는 `navigator.serial.getPorts()`에 남아 있는 승인 포트를 자동으로 엽니다. 승인 포트가 여러 개인데 저장된 식별 정보와 맞는 포트를 찾지 못하면 임의로 선택하지 않고 다시 사용자 선택을 요구합니다. 사이트 데이터 삭제, 다른 브라우저·배포 주소 사용, 권한 철회 뒤에는 다시 승인해야 합니다.

포트를 열면 기존 Controller Ping과 0x71/0x70 Request 1회를 자동으로 시도합니다. 연결 후에는 양쪽 스틱을 놓아 두세요. 네 축이 중립 범위 `±0.32` 안에 있을 때 약 `0.9초`, 최소 4개 표본을 평균해 중앙값을 자동으로 맞춥니다. 스틱을 잡고 있으면 극단값을 중앙으로 저장하지 않고 중립을 기다립니다. 필요하면 **스틱 중앙 다시 맞추기**를 누를 수 있으며, 정밀 범위·축 확인용 수동 캘리브레이션은 개발자 정보에 그대로 남아 있습니다.

### BYROBOT Mode 2 조종

검증된 0x71 stick 순서 `[Left X, Left Y, Right X, Right Y]`에는 다음 기본 의미 배치를 적용합니다. 실제 하드웨어 테스트 결과에 따라 **Yaw와 Roll 두 축을 반전**하고 Throttle과 Pitch 방향은 유지합니다.

```text
Left Y  → Throttle → 상승/하강
Left X  → Yaw      → 입력 부호 반전 후 좌우 회전
Right Y → Pitch    → 전진/후진
Right X → Roll     → 입력 부호 반전 후 기체 기준 좌우 이동
```

왼쪽 스틱 오른쪽은 기체의 오른쪽/시계 방향 Yaw, 오른쪽 스틱 오른쪽은 기체 기준 오른쪽 이동이어야 합니다. 빨간 선은 기체의 앞방향입니다.

학생용 **바이로봇 기본 조종**은 Mode 2 스틱 시동과 실제 스로틀 이륙이 기본입니다. 다만 연결 점검, 접근성 보조와 수업 복구를 위해 화면 아래의 **시동 / 이륙 / 착륙** 버튼도 유지합니다. 화면 시동은 동일한 `ARMED` 상태를 만들고, 화면 이륙은 `TAKEOFF → FLIGHT` 안전 상승을 실행하므로 튜토리얼과 자격시험 상태 기록에서도 빠지지 않습니다.

1. 양쪽 스틱을 아래쪽 안으로 모읍니다.
   - 왼쪽 스틱: 아래+오른쪽, 약 5시 방향
   - 오른쪽 스틱: 아래+왼쪽, 약 7시 방향
2. 지정 방향으로 raw Throttle/Pitch/Roll은 `-0.70` 이하, raw Yaw는 `+0.70` 이상인 상태를 끊지 않고 `3초` 유지합니다. 중간에 임계값을 벗어나면 3초 타이머는 처음부터 다시 시작합니다.
3. 화면이 `시동 준비`를 거쳐 `시동 완료(ARMED)`가 되고 프로펠러가 회전하는지 확인합니다.
4. 왼쪽 스로틀을 천천히 올립니다. raw Throttle이 `0.22` 이상이 되어 실제로 지면을 벗어나면 `FLIGHT`로 전환됩니다.
5. 착륙할 때는 스로틀을 낮춰 직접 천천히 하강합니다. raw Throttle `-0.55` 이하를 유지하고 지면 `0.12m` 이내에서 약 `0.65초` 안정되면 모터를 정지하고 `READY`로 돌아갑니다.

즉 학생 비행 상태는 다음 흐름입니다.

```text
READY(대기)
  → ARMING(Mode 2 시동 동작을 3초 유지)
  → ARMED(시동 완료, 지상)
  → FLIGHT(실제 스로틀로 이륙하고 비행)
  → READY(저스로틀로 착륙 완료)
```

기존 `START/TAKEOFF/LANDING` 명령 경로는 사용자 설정과 교사용 점검의 호환성을 위해 내부에 남아 있지만, 일반 학생의 기본 절차는 위 Mode 2 흐름입니다.

긴급 동작은 특정 제품의 `0x70` bit를 추측하지 않습니다. 검증된 기본 L 버튼이 없는 조종기는 화면에서 **긴급 기능** 버튼을 한 번 학습합니다. 이후 raw Throttle이 `-0.75` 이하인 상태에서 그 학습된 L 버튼을 함께 눌렀을 때만 긴급 안전 착륙을 한 번 실행합니다. 화면의 **긴급 안전 착륙**도 항상 남아 있습니다. 긴급 기능은 공중에서 모터를 즉시 꺼 추락시키는 기능이 아니라 수평 이동을 중립화하고 감속 하강하는 교육용 안전 착륙입니다.

### 조종감 설정

학생용 입력 처리 순서는 다음과 같습니다.

```text
Dead Zone 재조정 → Expo Curve → 사용자 감도 → 비행 속도 배율 → Smoothing
```

기본 Dead Zone은 `0.10`입니다. 절댓값이 `0.10` 이하인 입력은 0으로 만들고, 나머지 범위를 다시 `0…1`로 늘려 스틱 끝에서는 항상 최대 출력에 도달하게 합니다. 기본 Expo는 `0.45`이며 중앙에서는 부드럽고 끝으로 갈수록 크게 반응합니다. 이후 프레임 독립적인 지수 smoothing을 입력, 속도, 회전, 기울기에 적용해 자연스럽게 가속·감속합니다.

상승 중 실수로 들어오는 작은 회전을 줄이기 위해 raw Throttle이 `0.45` 이상이고 raw Yaw의 절댓값이 `0.20` 이하이면 Yaw만 0으로 억제합니다. 이 범위를 넘는 명확한 대각선 조작은 상승과 Yaw를 동시에 반영합니다.

조종기 연결이 끊기거나 입력 준비 조건을 잃거나 최신 stick 입력이 500ms 이상 멈추면 잔류 속도·회전 입력을 즉시 중립화합니다. 탭이 백그라운드로 가도 motion을 중립화하고 복귀 시 큰 frame delta를 적용하지 않습니다.

기본 비행 설정은 다음과 같습니다.

| 설정 | 기본값 | 선택값/범위 |
| --- | --- | --- |
| 비행 속도 | 일반 `65%` | 초보 `35%` / 일반 `65%` / 고속 `100%` |
| 조종 방식 | 바이로봇 기본 조종 | 바이로봇 기본 조종 / 사용자 설정 |
| 헤드리스 모드 | 끔 | 끔 / 켬 |
| 자세 안정화 | 켬 | 켬 / 끔 |
| 중앙 무시 범위 | `0.10` | `0.00…0.30` |
| 조종 감도 | `100%` | `50…150%` |
| Expo | `0.45` | `0.00…0.80` |

속도 배율은 Throttle, Yaw, Pitch, Roll 네 축 모두에 적용합니다. 내부 최대값은 수평 `3m/s`, 수직 `2m/s`, Yaw `π rad/s`이며 선택한 `35/65/100%` 배율을 곱합니다.

- **헤드리스 모드 끔**: Pitch/Roll 이동은 현재 기체 방향 기준
- **헤드리스 모드 켬**: 이륙을 시작한 순간의 Yaw를 기준 방향으로 저장하고 Pitch/Roll 이동만 그 기준을 사용. Yaw 회전과 빨간 앞방향 표시는 정상적으로 계속 회전
- **자세 안정화 켬**: 스틱을 놓으면 짧게 감속한 뒤 속도를 0으로 안정시키고 기울기를 빠르게 수평으로 복귀
- **자세 안정화 끔**: 감속과 기울기 복귀를 느리게 해 관성을 조금 더 유지

비행 설정과 조종기 버튼 설정은 접힌 **수업 준비**에 함께 들어 있습니다. **사용자 설정**을 선택하면 그 안에 Throttle/Yaw/Pitch/Roll의 Axis와 각 반전 여부, 시동/이륙/착륙/긴급/촬영·확인 버튼 설정이 나타납니다. 설정 중 누른 버튼은 즉시 명령으로 실행되지 않으며, 같은 버튼을 다른 기능에 지정하면 이전 지정은 해제됩니다.

점수가 매겨지는 활동(자격시험 진행 중, 임무 진행 중)에는 **수업 준비**를 표시하지 않습니다. 시험 도중 속도나 축 설정을 바꾸는 것은 정상 진행이 아니기 때문입니다. 다만 지금 진행에 반드시 필요한 버튼 설정(아직 학습하지 않은 긴급 L 버튼, 재난 탐색의 **촬영 / 확인**)은 **안전 기능 확인**으로 비행 화면에 그대로 남습니다.

속도, 조종 방식, 헤드리스, 자세 안정화, Dead Zone, 감도, Expo, 사용자 축 설정은 `byrobot-drone-simulator-preferences-v2`로 저장합니다. 이전 v1의 정확한 기본 축 설정은 하드웨어 테스트로 확정한 Yaw 방향을 반영해 한 번만 안전하게 이전하고, 사용자가 직접 바꾼 축 설정은 보존합니다. 사용자 버튼 설정은 `byrobot-drone-button-mappings-v3`에 컨트롤러 출처를 함께 저장해 다른 출처의 조종기에서는 실행되지 않습니다. 모두 개인정보가 아닌 브라우저 `localStorage` 설정입니다. **기본값 복원**은 비행 설정과 사용자 축 설정을 초기화하며, 버튼 매핑은 기능별 **지우기**로 해제합니다.

### 교육 과정

1. **조종법 안내 6단계**: Mode 2 시동, 실제 스로틀 이륙, 오른쪽 Yaw, 전진, 오른쪽 Roll 이동, 저스로틀 착륙을 한 단계씩 실제 비행 행동으로 완료합니다.
2. **기초 비행 훈련**: 순서가 지정된 링 3개를 통과하고 마지막 착륙 패드에 정밀 착륙합니다. 뒤 링을 먼저 지나도 통과로 처리하지 않으며 링 테두리와 장애물 접촉은 충돌로 기록합니다.
3. **90초 조종 자격시험**: 시동, 실제 이륙, 링 3개, Yaw 회전, 고도 변경, 정밀 착륙을 모두 완료해야 합니다. 점수는 링 30점, 충돌 없음 20점, 비행 안정성 20점, 착륙 정확도 20점, 시간 10점이며 필수 동작을 모두 수행하고 총점 `70점` 이상이어야 자격을 얻습니다.
4. **항공모빌리티 임무 선택**: 자격을 얻은 뒤 아래 두 임무 중 하나를 선택합니다.
   - **응급 의약품 운송**: 병원 A에서 출발해 건물과 강풍 구역을 피하고 `180초` 안에 병원 B 착륙장에 착륙합니다.
   - **재난지역 탐색**: `210초` 안에 목표 3곳 가까이에서 학습된 **촬영 / 확인** 버튼을 눌러 확인한 뒤 출발 착륙장으로 복귀합니다. 특정 버튼 값을 추측하지 않습니다.
5. **결과**: 자격시험은 항목별 점수와 합격 여부를, 임무는 총점과 화면에 표시되는 안전·안정성·착륙·임무 수행 별점, 활동 강점 유형과 직업 메시지를 보여 줍니다.

임무 배터리는 100%에서 시작하며 대기, 이동, 스로틀 사용량과 초보/일반/고속 배율에 따라 감소합니다. 고속일수록 더 빨리 줄고 `20%` 이하에서는 HUD와 피드백으로 저전력 경고를 표시합니다. HUD는 고도·속도·남은 시간·배터리·현재 목표·진행도와 충돌/강풍/긴급 경고를 계속 보여 줍니다.

### 화면에 값이 한 번만 나오게 하는 규칙

같은 값을 여러 곳에 표시하지 않습니다. 값마다 표시할 곳이 하나로 정해져 있습니다.

| 값 | 표시하는 곳 |
| --- | --- |
| 조종기 연결 준비 상태 | 왼쪽 **조종기 상태** 패널. 학생용 요약은 `StudentStatusHud`의 `조종기` |
| 비행 상태(대기/시동 준비/시동 완료/비행 가능…) | `StudentStatusHud`의 `현재 상태` |
| 고도·속도·남은 시간·배터리·현재 목표·진행도 | `FlightTrainingHud` |
| 기체 방향과 지상 위치 | 비행 화면 아래 `flight-telemetry` |
| 긴급 안전 착륙 | 비행 화면 위 오버레이 버튼 한 곳 |

새 표시를 추가할 때는 이 표에 자리를 정하고 추가합니다. 이미 있는 값을 다른 곳에 한 번 더 그리지 않습니다.

### 교사용 기능과 임시 시각 자산

접힌 **교사용 테스트 기능**에는 훈련 단계 초기화, 자격시험 바로 시작, 두 임무 바로 시작, 배터리 초기화, 드론 위치 초기화가 있습니다. 수업 준비와 기능 점검용이며 학생의 정상 진도 검증을 대신하지 않습니다.

현재 드론, 링, 착륙장, 건물, 병원, 탐색 지점, 강풍 표시는 고품질 미래도시 자산이 아니라 Canvas로 그린 임시 교육용 도형입니다. 충돌과 경로 판정은 데이터 기반 도메인 로직에 있고, 시각 요소는 `DroneVisual`/`DroneScenePresentation`으로 분리되어 있어 향후 GLB/GLTF와 미래도시 외형으로 교체할 수 있습니다.

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

BYROBOT 공식 Coding Drone/E-Drone 입력 예제는 포트를 연 뒤 Controller로 Ping을 보냅니다. E-Drone 펌웨어 기록에도 PC에서 데이터를 받은 뒤 조이스틱/버튼 전송을 시작한다고 명시되어 있습니다. 앱은 포트를 열 때 이 Ping과 입력 Request 1회를 자동 시도하며, 수동 재전송과 비교 진단을 위한 **BYROBOT 입력 활성화 (Controller Ping)** 버튼도 개발자 정보에 유지합니다.

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

Generic Gamepad 프로필에는 검증된 기본 축이나 버튼 배치가 없습니다. **사용자 설정**을 선택해 각 Axis와 반전 여부를 Throttle/Yaw/Pitch/Roll에 직접 배정해야 Common ControllerState가 완성됩니다. 개발자 캘리브레이션을 시작해 중앙과 범위를 모두 확보한 경우에는 그 완성된 캘리브레이션이 사용자 축 설정보다 우선합니다.

## 5. Serial 테스트 방법

학생의 일반 연결 순서는 다음과 같습니다.

1. 조종기를 USB LINK 모드로 연결하고 Chrome에서 배포 주소 또는 localhost를 엽니다.
2. 처음 사용하는 origin이면 **조종기 처음 연결하기**를 누르고 COM 포트를 한 번 승인합니다. 선택 직후 포트를 열고 Ping/Request를 자동 시도합니다.
3. 이미 승인된 포트가 하나이거나 저장된 VID/PID와 일치하면 다음 방문과 물리 재연결 때 자동으로 연결됩니다.
4. 양쪽 스틱을 놓고 `스틱 중앙: 정상`과 `조종 준비 완료`가 될 때까지 잠시 기다립니다.
5. 자동 연결에 실패하거나 승인 포트가 여러 개면 사용자가 사용할 포트를 다시 선택합니다.

아래는 접힌 **개발자 정보 보기**에서 현재 스마트 조종기의 연결과 입력 획득을 수동으로 점검하는 순서입니다.

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
- 검증된 0x71 8-byte profile의 기본 네 축 배치 또는 사용자가 완료한 calibration으로 Common ControllerState가 `mapped`인 상태에서만 입력 계층의 `조종 준비 완료`

## 8. 진단 단계의 의미

| 단계 | PASS 조건 |
| --- | --- |
| DEVICE DETECTED | Serial 포트를 선택했거나 Gamepad 객체를 감지 |
| TRANSPORT OPEN | Serial `port.open()` 성공. Gamepad는 N/A |
| DATA RECEIVED | Serial에서 실제 1 byte 이상 수신 또는 Gamepad snapshot 수신 |
| PACKET PARSED | 완전한 BYROBOT profile frame의 length와 CRC 통과. Gamepad는 N/A |
| CONTROLLER INPUT ACTIVE | 검증된 adapter가 실제 축 delta 또는 버튼 edge를 확인 |

Serial의 `CONTROLLER INPUT ACTIVE`는 CRC-valid 0x71의 실제 stick 변화와 공식 0x70의 버튼 상호작용이 모두 확인된 경우에만 PASS입니다. 이 증거는 연결 세션 동안 유지되고 재연결 시 초기화됩니다. 입력 계층의 `조종 준비 완료`는 여기에 네 의미 축의 검증된 기본 profile 또는 사용자 mapping까지 완성된 경우에만 표시합니다.

이 입력 준비 상태와 비행 상태기계의 `READY(대기)`는 서로 다른 상태입니다. 조종기가 준비되어도 드론은 먼저 대기 상태에 있으며, Mode 2 조합을 3초 유지해 `ARMED`로 만든 후 실제 스로틀로 이륙해야 `FLIGHT`의 수동 비행 입력을 받습니다.

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

### 일반 사용자 자동 중앙 보정

Serial 연결 뒤에는 학생이 별도 축 설정을 하지 않아도 되도록 자동 중앙 보정을 먼저 수행합니다. 네 스틱 축이 모두 중립 후보 범위 `±0.32` 안에 있을 때만 표본을 받으며, 약 `0.9초` 동안 최소 4개 표본을 평균해 각 축의 중앙값으로 사용합니다. 연결할 때 스틱을 기울이고 있으면 그 값을 중앙으로 저장하지 않고 스틱이 놓일 때까지 기다립니다.

화면의 **스틱 중앙 다시 맞추기**로 언제든 다시 시작할 수 있습니다. 자동 중앙값은 검증된 BYROBOT 기본 profile과 사용자 설정의 고정 Axis mapping 모두에 적용됩니다. 아래 수동 calibration은 제품 조사와 범위 보정이 필요할 때만 개발자 정보에서 사용합니다.

### 개발자 수동 축 캘리브레이션

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

엄격하게 해석된 BYROBOT 0x71 8-byte profile에는 기본 배치 `Left X→Yaw`, `Left Y→Throttle`, `Right X→Roll`, `Right Y→Pitch`를 적용합니다. 실제 사용자 검증 결과에 따라 **Left X→Yaw와 Right X→Roll의 입력 부호를 반전**하고, Throttle과 Pitch 방향은 바꾸지 않습니다. 이 preset은 codec ID, DataType `0x71`, payload 길이 `8`, axis 수 `4`가 모두 맞을 때만 활성화됩니다.

**사용자 설정**에서는 저장된 Axis/반전 설정을 사용합니다. 사용자가 개발자 캘리브레이션을 시작하고 네 축의 중앙·범위·의미 배정을 모두 완료한 경우에는 그 캘리브레이션이 저장된 고정 Axis 설정보다 우선합니다. 다른 제품 profile은 같은 채널 순서라고 가정하지 않으며, adapter가 검증한 raw axis 순서 또는 사용자 설정이 필요합니다. `min < center < max`가 확보되지 않은 calibration 값은 정규화하지 않습니다.

## 13. ControllerAdapter 구조

```text
src/controllers/
├─ types.ts                         # ControllerState, adapter, diagnostics, errors
├─ controller-manager.ts            # registry, ranking, active adapter, 입력 준비 판정
├─ calibration.ts                   # axis 관측/중앙/범위/dead-zone/정규화
├─ center-calibration.ts            # 중립 확인 후 자동 중앙값 표본·평균
├─ profiles/
│  ├─ types.ts                       # 축 preset, 조작 gesture, 검증 근거 타입
│  ├─ byrobot-profiles.ts            # Smart/PRC-95/Battle/Generic/Gamepad 프로필
│  ├─ gesture-runtime.ts              # 버튼·제품별 길게 누르기·스틱/버튼 chord 실행기
│  ├─ operation-discovery.ts         # 기본 조작 확인 기록용 순수 모델
│  └─ index.ts                       # 프로필 공개 API
├─ connections/
│  ├─ serial-auto-connect.ts        # 승인된 port 재발견·VID/PID 일치·다중 port 보수 처리
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
├─ settings.ts                       # 저장 가능한 수업용 설정과 사용자 축 mapping
├─ mode2-gesture-detector.ts         # Mode 2 3초 시동 gesture 진행·초기화
├─ flight-controller.ts              # ControllerState, stale/disconnect 안전, 명령 조정
├─ flight-model.ts                   # 입력 보정, 상태기계, 결정론적 비행 물리
├─ experience-coordinator.ts         # 튜토리얼·코스·시험·미션을 비행 상태와 조율
├─ scene-presentation.ts             # 장면 marker/collision 표시용 중립 모델
├─ drone-transform.ts                # 물리 상태를 렌더링용 transform으로 변환
└─ button-mapping.ts                 # 출처별 버튼 캡처와 rising-edge 명령 매핑

src/experience/
├─ experience-state.ts               # START부터 RESULT까지 수업 단계 reducer
├─ tutorial-runtime.ts               # 실제 비행 6단계 조작 안내
├─ training.ts                       # 순서가 있는 3-gate 훈련·충돌·착륙 판정
├─ certification.ts                  # 90초 시험 요건·가중치 채점
├─ missions.ts                       # 의료품 운송·재난 탐색 정의와 runtime
├─ battery.ts                        # 비행 입력·속도 단계별 배터리 소모
├─ results.ts                        # 시험·미션 결과와 강점/직업 메시지
└─ teacher-tools.ts                  # 수업 준비용 교사 단축 명령

src/components/
├─ controller-diagnostics.tsx        # 전체 조립과 접이식 개발자 진단 UI
├─ controller-simple-ui.tsx          # 한글 연결/스틱 상태
├─ drone-simulator.tsx               # 비행 UI와 FlightController 조립
├─ drone-visual.tsx                  # 임시 드론·코스 marker Canvas 렌더링만 담당
├─ flight-settings-panel.tsx         # 수업용 비행 설정
├─ use-simulator-preferences.ts      # localStorage 설정 수명주기
├─ byrobot-operation-capture.tsx     # 프로필 개발용 기본 조작 증거 기록
└─ experience/                       # 안내, HUD, 미션 선택, 결과, 교사 UI
```

Web Serial 연결/RAW 처리 핵심은 `src/controllers/adapters/byrobot-serial-base.ts`, 순수 stream parser는 `src/controllers/protocols/byrobot/parser.ts`에 있습니다. 이 기존 경로는 비행 구현과 분리되어 있습니다.

시뮬레이터는 packet/Serial 모듈을 직접 읽지 않고 오직 `ControllerState` 안의 의미 축과 protocol-neutral `buttonTransitions`만 입력으로 받습니다. `FlightController`는 연결 해제·stale input 안전과 상태 명령을 담당하고, `flight-model.ts`는 비행 물리를 계산합니다. `ExperienceCoordinator`는 그 비행 상태를 읽어 튜토리얼·훈련·시험·미션을 진행하고, 한정된 강풍/충돌 결과와 중립 `DroneScenePresentation`을 되돌려줍니다. `DroneTransform`은 위치·Yaw·기울기·프로펠러 속도만 `DroneVisual`에 전달합니다. 따라서 향후 Canvas 임시 외형을 GLB/GLTF 모델로 바꿔도 USB, parser, ControllerState, 비행·수업 로직을 수정할 필요가 없습니다. Serial과 Gamepad adapter는 같은 공통 버튼 전이 형식을 생산합니다.

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
10. `ControllerProfile`에 검증된 축 preset, 모델 상태, 출처 링크를 기록하고 adapter의 `controllerProfile`로 제공
11. raw axis 순서를 먼저 노출하고 의미 축은 calibration/profile로 분리
12. 시동/이륙/착륙/긴급/촬영·확인 조작은 공식 물리 버튼 설명만으로 만들지 않고, 실제 USB 입력까지 확인된 경우에만 executable 기본 gesture로 등록. 프로필은 버튼 down, 제품별 길게 누르기 시간, 다중 버튼, 스틱 조합, 스틱+버튼 chord를 표현할 수 있음
13. CRC/length/축/버튼 변화와 잘못된 프로필 차단 테스트 추가

제품 adapter를 추가해도 3D 시뮬레이터나 게임 코드는 수정하지 않습니다. 이후 시뮬레이터는 Common ControllerState만 구독합니다.

### 바이로봇 기본 조작 확인 기록

접힌 **개발자 정보 보기** 안의 **바이로봇 기본 조작 확인**은 새로운 제품 프로필을 만들 때 사용하는 기록 도구입니다.

1. BYROBOT Serial 조종기를 연결하고 입력을 활성화합니다.
2. 시동/이륙/착륙/긴급 가운데 하나의 **기록 시작**을 누릅니다.
3. 실제 조종기에서 해당 동작을 수행합니다.
4. **기록 완료**를 누릅니다.
5. 동작별 기록을 마친 뒤 **기록 복사**로 JSON을 저장합니다.

기록에는 해당 연결 세션, 프로필, 장치 식별 문자열과 CRC-valid 0x71/0x70 패킷의 수신 순서, timestamp, From/To, payload가 포함됩니다. 화면의 250ms 최신값 표본과 별도로 adapter가 패킷 저널을 유지하며, 한 동작당 최근 500개 패킷과 초과 개수를 저장합니다. 연결 세션이 바뀌면 임시 기록을 지웁니다. 이 자료는 **증거 수집 전용**이며 자동 버튼 매핑이나 비행 명령에 사용하지 않습니다.

## 16. 현재 지원 범위

### 구현됨

- 모든 브라우저 Gamepad API 장치의 raw axes/buttons/info
- Web Serial 포트 선택, 9600/57600/115200, 8N1
- 최초 1회 사용자 승인 후 `navigator.serial.getPorts()`와 저장된 VID/PID 정보를 이용한 보수적 자동 재연결
- 공식 BYROBOT device-addressed frame 복원과 CRC 검증
- 같은 start code를 쓰는 legacy profile을 별도 정의할 수 있는 parser 구조
- Generic BYROBOT Serial 진단과 명시적인 Coding/E-Drone input profile 후보
- RAW 변화 관찰, 최근 100개 로그, 복사/일시정지/지우기
- 포트 open 후 공식 Controller Ping과 0x71/0x70 Request 1회 자동 시도, 수동 진단 제어 유지
- CRC-valid DataType별 최근 5초 count와 동일 DataType payload 변화 표시
- 공식 Coding/E-Drone 8-byte Joystick과 3-byte Button strict decode
- Left X/Y, Right X/Y, direction/event, button bitmask/event 실시간 표시
- 공식 Request 1회 및 사용자 제어 진단 polling fallback
- 스틱이 중립일 때만 작동하는 약 0.9초 자동 중앙 보정과 수동 재시작
- calibration 결과를 실제 mapped Common ControllerState로 projection
- 사용자 지정 Gamepad axis calibration/mapping
- 한글 중심의 연결·입력 상태와 실시간 stick 게이지
- 기존 기술 진단 전체를 접이식 **개발자 정보 보기**로 보존
- strict 0x71 조건을 통과한 프로필의 기본 stick 배치, Yaw·Roll 부호 보정, 사용자 설정/calibration override
- Dead Zone 재조정, Expo, 감도, 프레임 독립 exponential smoothing, 긴 frame delta 제한
- 상승 중 작은 Yaw 억제와 명확한 대각선 조작 보존
- 초보 35% / 일반 65% / 고속 100% 비행 속도
- 헤드리스 모드와 자세 안정화 ON/OFF
- 학생 기본 조종의 `READY → ARMING → ARMED → FLIGHT → READY` 상태와 `EMERGENCY`; 기존 START/TAKEOFF/LANDING 명령은 사용자 설정·교사 점검 호환용으로 유지
- Mode 2 스틱 조합 3초 시동, ARMED 후 실제 스로틀로 이륙, 저스로틀 유지로 직접 착륙
- 학습한 논리 L 버튼+스로틀 down 조합의 1회성 긴급 안전 착륙과 화면 긴급 안전 착륙
- 빠른 0x70 down→up과 같은 timestamp의 연타 순서를 보존하는 128-transition button journal
- 사용자 설정에서 실제 조종기 버튼을 시동/이륙/착륙/긴급/촬영·확인에 지정하는 source-scoped 매핑
- 수업용 비행 설정과 사용자 Axis/반전 설정의 localStorage 저장
- ControllerProfile과 기본 조작 증거 기록 구조
- Mode 2·실제 이륙·Yaw·전진·Roll·저스로틀 착륙을 순서대로 완료하는 6단계 조종 안내
- 순서가 정해진 3개 gate, 장애물, 정밀 착륙을 포함한 기초 비행 훈련
- 90초 안에 시동·이륙·3-gate·Yaw 60°·고도 0.8m 변화·정상 착륙을 요구하는 100점 자격시험과 70점 합격 기준
- 의료품 운송(180초, 강풍 구역, 병원 B 착륙)과 재난 탐색(210초, 3개 목표 확인, 원점 복귀) 미션
- 100%에서 시작해 대기·이동·스로틀·속도 단계에 따라 소모되는 배터리와 20% 이하 저전력 경고
- 고도·속도·시간·배터리·목표·진행도·충돌/강풍/긴급 경고 HUD과 시험/미션 결과 화면
- 훈련 초기화, 시험·두 미션 즉시 시작, 배터리·드론 위치 초기화를 포함한 접이식 교사 테스트 기능
- FlightController/FlightPhysics/DroneTransform/DroneVisual과 ExperienceCoordinator/DroneScenePresentation 분리
- 현재 드론, gate, 착륙장, 건물, 병원, 탐색 지점, 강풍 구역은 고품질 미래도시가 아닌 Canvas 기반 임시 교육용 자산

### ControllerProfile 상태

| 프로필 | 모델 상태 | 조건부 기본 축 | 실행 가능한 기본 버튼 |
| --- | --- | --- | --- |
| BYROBOT Smart Controller | 미확인 | strict 0x71 조건을 모두 만족할 때만 적용 | 없음 |
| PRC-95 계열 | 미확인 | strict 0x71 조건을 모두 만족할 때만 적용 | 없음 |
| BYROBOT Battle Drone Controller | 후보 | strict 0x71 조건을 모두 만족할 때만 적용 | 없음 |
| Unknown BYROBOT Controller | 미확인 | strict 0x71 조건을 모두 만족할 때만 적용 | 없음 |
| Generic Gamepad | 미확인 | 없음, 사용자 설정 필요 | 없음 |

strict 0x71 조건은 codec ID `coding-e-drone-controller-input-v1`, DataType `0x71`, payload 길이 `8`, axis 수 `4`가 모두 일치하는 것입니다. 이 조건은 축 payload 사용 근거일 뿐 제품 모델을 확정하는 근거가 아닙니다.

Battle Drone 공식 사용자 매뉴얼에는 대기/비행 상태에서 물리 1번 버튼을 길게 눌러 이륙/착륙하는 조작과 스로틀 아래+1번 버튼의 강제 정지 조작이 설명되어 있습니다. 그러나 이 물리 버튼 번호를 USB `0x70`의 특정 button ID/bit와 연결하는 공식 근거와 실제 capture가 없으므로 앱은 이를 자동 실행 기본값으로 등록하지 않습니다. 안전 착륙과 실제 강제 정지도 같은 기능이라고 가정하지 않습니다.

### 아직 실제 장치 검증 전

- 현재 사용 중인 Smart Controller의 정확한 USB descriptor와 Information modelNumber
- 사용자가 지칭한 PRC-95의 공식 제품 식별과 protocol
- BYROBOT Battle Drone Controller의 실제 USB capture가 Coding/E-Drone 8/3-byte profile과 일치하는지
- PRC-95/Battle Drone 등 다른 제품 profile의 throttle/yaw/pitch/roll 의미 채널 배정
- Smart/PRC-95/Battle의 시동/이륙/착륙/긴급 물리 조작과 USB `0x70` button ID/bit의 대응
- 같은 origin에서 승인 포트 자동 재연결, 자동 중앙 보정, Mode 2 3초 시동, ARMED 후 실제 스로틀 이륙·저스로틀 착륙의 연속 실기
- 학습한 L 버튼+스로틀 down 긴급 조합과 튜토리얼·3-gate 훈련·90초 자격시험·두 미션의 실제 조종기 end-to-end 수업 검증

Smart/PRC-95/Battle 제품 placeholder는 기본적으로 RAW-only codec과 Request 비활성 정책을 사용합니다. 실제 모델/캡처 근거가 확보되기 전에는 Coding/E-Drone layout을 자동 상속하지 않습니다. 현재 진단 화면의 Generic adapter만 주소 `Controller(0x20) → Base(0x70)`, 8/3-byte 길이, 축 범위를 모두 검증하는 Coding/E-Drone 공식 profile 후보를 명시적으로 사용합니다.

공식 Coding Drone 정의의 `0x00032004 = Battle Drone Controller USB`는 match 근거로만 준비되어 있으며, 실제 Information 응답을 받기 전에는 Battle Drone 모델로 확정하지 않습니다. PRC-95를 공식 제품명 `BATTLE DRONE (BRB-95)`와 같은 제품이라고 가정하지 않습니다.

사용자 환경에서는 기존 Serial 연결, 0x71 stick, 0x70 button, ControllerState와 가상 드론의 상승/하강·전진/후진·Yaw·Roll 조종까지 정상 작동했다고 전달받았습니다. 이 개발 환경 자체에는 실제 조종기가 연결되어 있지 않습니다. 따라서 추가된 자동 재연결·자동 센터, Yaw/Roll 방향 보정, Mode 2 시동·실제 이륙·착륙, 학습 L 긴급 조합, 조종감 설정, 전체 교육 과정을 실제 하드웨어로 검증했다고 임의로 주장하지 않습니다. 순수 로직의 자동 테스트는 별도로 있지만 실제 조종기·Chrome 권한·수업 환경 검증을 대신하지 않으며, 아래 절차로 확인해야 합니다. 현재 **실행 가능한 제품별 기본 버튼 profile이 확정된 모델은 없습니다.**

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

## 18. 실제 조종기 수업 검증 순서와 성공 조건

### A. 연결과 자동 준비

1. Windows Chrome에서 조종기를 USB LINK 모드로 연결하고 **체험 시작**을 누릅니다.
2. 해당 브라우저·배포 주소에서 처음이면 왼쪽의 **조종기 처음 연결하기**를 한 번 누르고 올바른 COM 포트를 승인합니다. 첫 권한 승인은 자동화할 수 없습니다.
3. 포트가 열리면 Ping과 0x71/0x70 Request가 자동 시도되는지, USB 연결·스틱 입력·버튼 입력이 모두 `정상`이 되는지 확인합니다. 입력 증거를 만들기 위해 스틱과 버튼을 각각 한 번 조작합니다.
4. 스틱을 모두 중앙에 놓고 약 0.9초 기다립니다. `스틱 중앙: 정상`과 `조종 준비 완료`가 되는지 확인하고, 틀리면 **스틱 중앙 다시 맞추기**를 사용합니다.
5. 새로 고침 또는 다음 방문에서 기존 승인 포트가 자동으로 열리는지 확인합니다. 승인 포트가 여러 개인데 저장된 VID/PID와 일치하는 포트를 확정할 수 없으면 자동 선택하지 않는 것이 정상입니다.

### B. Mode 2 시동과 실제 비행

1. **기본값 복원**으로 일반 65%, 바이로봇 기본 조종, 헤드리스 끔, 자세 안정화 켬, Dead Zone 0.10, 감도 100%, Expo 0.45를 확인합니다.
2. **조종법 익히기 시작**을 누르고 양쪽 스틱을 아래 안쪽으로 모읍니다(왼쪽 5시, 오른쪽 7시). 임계값을 중간에 벗어나지 않고 3초 유지해 `ARMING`의 진행도가 차고 `ARMED(시동 완료)`가 되는지 확인합니다. 중간에 스틱을 놓으면 시간이 초기화되어야 합니다.
3. ARMED 상태에서 왼쪽 스로틀을 천천히 올립니다. raw Throttle `0.22` 이상으로 실제 지면을 벗어날 때만 `FLIGHT(비행 가능)`로 바뀌어야 합니다. 이것이 학생 기본 이륙입니다.
4. 별도로 화면 **위치 초기화 → 시동 → 이륙**을 차례로 눌러 `READY → ARMED → TAKEOFF → FLIGHT`와 고도 상승이 실제 화면에서도 동작하는지 확인합니다. 이 경로는 연결 점검과 수업 보조용입니다.
4. 빨간 선을 기체의 앞으로 보고 네 축을 하나씩 확인합니다. 왼쪽 위/아래는 상승/하강, 왼쪽 오른쪽/왼쪽은 오른쪽/왼쪽 Yaw, 오른쪽 위/아래는 전진/후진, 오른쪽 오른쪽/왼쪽은 기체 기준 오른쪽/왼쪽 이동이어야 합니다. 구현에서는 Yaw와 Roll 입력 부호를 보정했고 Throttle과 Pitch 부호는 변경하지 않았습니다.
5. 중앙 근처 `≤ 0.10`의 흔들림은 이동을 만들지 않고, 약한 입력은 Expo로 느리게, 끝까지 밀은 입력은 선택 속도의 최대 출력으로 작동하는지 확인합니다.
6. 스로틀을 위로 올릴 때 작은 Yaw 흔들림은 억제되고, 명확하게 대각선으로 밀면 상승과 Yaw가 같이 반영되는지 확인합니다.
7. 초보 35% → 일반 65% → 고속 100%에서 네 축 속도를 비교하고, 헤드리스 OFF/ON에서 기체 기준/이륙 당시 기준 방향의 차이를 확인합니다. 자세 안정화 ON은 스틱을 놓으면 짧게 감속한 뒤 수평으로 멈추고, OFF는 관성과 기울기가 더 오래 남아야 합니다.
8. 착륙은 스로틀을 낮춰 직접 하강합니다. raw Throttle `-0.55` 이하, 고도 `0.12m` 이내에서 약 `0.65초` 유지하면 프로펠러가 멈추고 `READY`로 돌아가야 합니다.

### C. 튜토리얼, 훈련, 자격시험, 미션

1. 화면 안내에 따라 Mode 2 시동 → 실제 스로틀로 1m 이륙 → 오른쪽 Yaw 60° → 2.5m 전진 → 오른쪽 Roll 목표 진입 → 저스로틀 착륙의 6단계를 실제 조종으로 완료합니다.
2. **기초 비행 훈련장**에서 번호 순서대로 gate 3개를 통과하고, 장애물/링 충돌 피드백과 마지막 정밀 착륙 판정을 확인합니다. 뒤 번 gate를 먼저 통과해도 진행도가 올라가면 안 됩니다.
3. **조종 자격시험**에서 90초 안에 시동, 실제 이륙, 3-gate, Yaw 60° 이상, 고도 변화 0.8m 이상, 정상 착륙을 모두 수행합니다. gate 30점, 무충돌 20점, 안정성 20점, 착륙 20점, 시간 10점이며 필수 요건 전체와 총점 70점 이상을 모두 만족해야 합격입니다.
4. 합격 후 **응급 의약품 운송**을 선택해 180초 안에 병원 A에서 출발하고, 강풍 구역의 표시/힘을 경험한 뒤 병원 B에 착륙합니다.
5. **재난지역 탐색**에서는 먼저 **촬영 / 확인** 설정을 누르고 조종기의 실제 버튼을 학습시킵니다. 210초 안에 목표 3곳 가까이에서 그 버튼을 눌러 확인하고 출발 착륙장으로 복귀합니다. 제품별 button bit는 추측하지 않습니다.
6. HUD의 고도, 속도, 남은 시간, 배터리, 현재 목표, 진행도와 충돌·강풍·목표 확인·저전력 피드백을 확인합니다. 배터리는 고속일수록 빠르게 소모되고 20% 이하에서 경고합니다. 현재 배터리 0% 자체는 미션을 즉시 종료시키는 조건으로 가정하지 않습니다.
7. 시험 결과에서 항목별 점수와 합격/재도전을, 미션 결과에서 총점과 화면에 표시되는 안전·안정·착륙·목표 별점, 조종 강점 유형, 직업 메시지를 확인합니다.

### D. 안전, 교사 기능, 개발자 회귀 확인

1. **안전 기능 확인**의 **긴급정지 L 버튼** 설정에서 실제 L로 쓸 버튼을 한 번 학습시킵니다. 비행 중 raw Throttle `-0.75` 이하와 학습한 L 버튼을 같이 입력했을 때만 긴급 안전 착륙이 한 번 시작되어야 합니다. L 버튼만 누르거나 스로틀만 낮춰서는 긴급 명령이 발생하면 안 됩니다.
2. 화면의 **긴급 안전 착륙**은 버튼 profile이 없어도 항상 사용할 수 있어야 합니다. 두 긴급 경로 모두 공중에서 모터를 즉시 끊어 추락시키지 않고, 수평 입력을 무시하고 감속 하강해야 합니다.
3. 접힌 **교사용 테스트 기능**에서 훈련 초기화, 자격시험 바로 시작, 의료/재난 미션 바로 시작, 배터리 초기화, 드론 위치 초기화를 점검합니다. 이 기능은 수업 준비와 테스트용이지 학생 정상 진행 인정용이 아닙니다.
4. 연결을 해제하거나 500ms 이상 입력이 끊겼을 때 드론의 수평 속도와 Yaw rate가 중립화되는지 확인합니다.
5. **개발자 정보 보기**를 펼쳐 기존 RAW, DataType, parsed packet, CRC, calibration, 기본 조작 기록이 계속 작동하는지 확인합니다.

실제 장치 승인 기준은 다음과 같습니다.

- 자동 재연결과 자동 중앙 보정 후 0x71/0x70과 `ControllerState`가 정상
- Mode 2 3초 시동 → ARMED → 실제 스로틀 이륙 → FLIGHT → 저스로틀 착륙 → READY가 순서대로 작동
- Throttle/Pitch 방향은 기존과 같고 Yaw/Roll은 학생이 보는 오른쪽/왼쪽 조작과 일치
- Dead Zone·Expo·smoothing·상승 중 Yaw 억제가 중립 조종을 쉽게 하면서 명확한 대각선과 최대 출력을 보존
- 초보/일반/고속, 헤드리스, 자세 안정화의 차이를 실제 조종으로 구분 가능
- 학습 L+저스로틀 긴급 조합과 화면 대체 기능이 모두 안전 착륙으로 작동
- 6단계 조종법, 3-gate 훈련, 90초 자격시험, 의료품 운송, 재난 탐색, HUD, 배터리, 결과가 종단간 완주
- 현재 임시 드론·코스 자산과 빨간 앞방향 표시가 유지되고 비행/수업 로직과 분리
- 기존 Serial, RAW, parser, CRC, 0x71, 0x70, ControllerAdapter 기능이 회귀 없이 유지

위 하드웨어 항목은 이 개발 환경에서 실제 조종기로 확인할 수 없었습니다. 현재 문서는 **구현된 테스트 절차**를 제공하며, 실제 성공 승인은 위 절차를 사용자의 BYROBOT 조종기와 Windows Chrome에서 완주한 뒤에만 가능합니다. 이후 고품질 드론/GLB·GLTF 모델과 미래도시 자산을 추가하더라도 Serial packet이 아닌 `ControllerState`과 분리된 비행/체험 경계만 사용해야 합니다.

## 19. 공식 참고 자료

- [Coding Drone Protocol Intro](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/01_intro/)
- [Coding Drone DataType](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/03_datatype/)
- [Coding Drone Protocol Structs](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/05_structs/)
- [E-Drone Protocol Structs](https://dev.byrobot.co.kr/documents/kr/products/e_drone/protocol/05_structs/)
- [Coding Drone Input Example](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/library/python/coding_drone/examples_12_input/)
- [Coding Drone Definitions](https://dev.byrobot.co.kr/documents/kr/products/coding_drone/protocol/04_definitions/)
- [E-Drone Definitions](https://dev.byrobot.co.kr/documents/kr/products/e_drone/protocol/04_definitions/)
- [E-Drone Firmware Updates](https://dev.byrobot.co.kr/documents/kr/products/e_drone/log/updates/firmware/)
- [Battle Drone Product Page](https://dev.byrobot.co.kr/documents/kr/products/battle_drone/)
- [Battle Drone User Manual](https://dev.byrobot.co.kr/documents/kr/products/battle_drone/manual/user/)
- [Legacy Petrone Link Protocol](https://dev.byrobot.co.kr/documents/kr/products/petrone/protocol/link/01_intro/)
- [Official CodingDrone CRC source](https://github.com/AluxDrone/CodingDrone/blob/master/CodingDrone/crc.py)
