# CHAIR ARCHIVE 배포 안내 (GitHub + Vercel)

2026-10-20 점검 기준. 디자인·인터랙션 코드는 바꾸지 않았고, 배포에 필요한 설정 파일만 추가했다.

## 1. 점검 결과

| 항목 | 결과 |
|---|---|
| 프레임워크 | Vite 8 + Vanilla JS (멀티 페이지: `index.html`, `about.html`, `detail.html`), Three.js r186, GSAP 3.15 |
| 빌드 | `npm ci` → `npm run build` 성공 (출력 `dist/`). 3D 상세 페이지 번들이 500kB를 넘는다는 Vite 안내만 있음 (오류 아님) |
| 상세 페이지 주소 | `/detail/001`~`/detail/007` 은 실제 파일이 없는 주소라 `vercel.json`의 rewrite로 `detail.html`에 연결 |
| 에셋 경로 | 코드가 참조하는 63개 파일(GLB 8, HDRI, 텍스처 팩, 이미지)이 모두 존재하고 대소문자도 일치 (Vercel 서버는 대소문자를 구분) |
| 개발용 기능 | `?glb=`, `?ev=`, `?grade=`, `?compare` 테스트 기능은 배포 빌드에서 자동으로 꺼짐 |

배포와 같은 조건(Git에 올라갈 파일만 복사 → `npm ci` → 빌드 → `vercel.json` 규칙으로 서빙)으로 실제 브라우저에서 확인한 것:

- `/detail/001`~`/detail/007` 직접 접속·새로고침 → 7개 모두 해당 GLB 로드, 콘솔 오류 없음 (`/detail/007/`처럼 끝에 `/`가 있어도 동작)
- 없는 주소(`/detail/abc`, `/detail/0011`)는 404
- 메인 ↔ CHAIR DNA 전환 1.5초, 버블 순차 등장, 드래그, 결합·키워드, 반발, 왕복 후 결합 상태 유지

## 2. 올라가는 파일과 제외되는 파일 (`.gitignore`)

파일은 지우거나 옮기지 않았다. Git에만 포함되지 않으므로 GitHub·Vercel에 올라가지 않고 로컬에는 그대로 남는다.

**올라가는 것: 이 문서 포함 102개 파일, 약 111MB**

| 실제 페이지가 쓰는 GLB | 크기 |
|---|---|
| chair-001-keyshot-all-materials-merged.glb | 25.9 MB |
| chair-002.glb | 3.6 MB |
| chair-003-textured.glb | 5.8 MB |
| chair-004.glb | 8.5 MB |
| chair-005-keyshot-optimized.glb | 50.3 MB (48 MiB) |
| chair-005.glb (005 분해용 파트 정보) | 0.7 MB |
| chair-006.glb | 2.3 MB |
| chair-007-seat-angled.glb | 1.9 MB |
| **합계** | **약 99 MB** |

그 밖에 `public/textures/chair_material_pack` 14 MB, `public/env` HDRI 1.7 MB, 의자 이미지 1.3 MB.

**제외되는 것**

- `public/models`의 테스트·원본 GLB 14개 (약 386 MB). 특히 `chair-005 keyshot final.glb`(245 MB)는 GitHub 파일 한도(100 MiB)를 넘어 올릴 수 없다.
- `backup/` 작업 백업, `.claude/` 로컬 설정
- `public/design/` 디자인 레퍼런스 이미지 (개발용 비교에만 쓰이고, 제품 사진 레퍼런스가 포함되어 있어 공개하지 않음). 올리고 싶으면 `.gitignore`에서 해당 두 줄을 지우면 된다.

나중에 사이트에서 다른 GLB로 바꾸면 `.gitignore`의 허용 목록(`!public/models/...`)에도 그 파일 이름을 추가해야 한다.

## 3. 용량·요금제 확인

| 제한 | 기준 | 이 프로젝트 |
|---|---|---|
| GitHub 파일 1개 | 50 MiB부터 경고, 100 MiB 초과 차단 | 가장 큰 파일 48 MiB → 통과 |
| GitHub 저장소 권장 | 1 GB 이하 | 약 111 MB |
| Vercel CLI 업로드 (Hobby) | 100 MB | GitHub 연결 방식을 쓰므로 해당 없음 |
| Vercel 전송량 (Hobby) | 월 100 GB | 아래 참고 |
| Vercel Hobby 용도 | 비상업적 개인 사용만 | 포트폴리오·학습용이면 가능. 상업적 사용이면 Pro 필요 |

전송량 감각: 메인·ABOUT은 가볍지만, 방문자가 상세 페이지 7개를 모두 열면 약 115 MB를 받는다. 월 100 GB면 "모든 상세 페이지를 다 보는 방문"이 약 850회 정도다. 같은 브라우저의 재방문은 캐시를 쓴다. 방문이 많아지면 GLB를 Draco/Meshopt로 압축한 파생 파일을 만드는 것을 검토할 수 있다 (원본 GLB는 수정하지 않음).

## 4. 직접 해야 하는 일

### 4-1. GitHub 저장소 만들기와 업로드

1. GitHub에서 새 저장소를 만든다. 예: `chair-archive`. README·.gitignore·License는 추가하지 않는다 (빈 저장소). 공개(Public)/비공개(Private) 모두 Vercel 연결 가능.
2. 이 폴더(`002-chair-archive`)에서 아래 명령을 차례로 실행한다.

```bash
git init -b main
```

```bash
git add .
```

```bash
git status
```

`git status` 목록에 `public/models`는 GLB 8개만, `backup/`·`public/design/` 파일은 없어야 한다.

```bash
git commit -m "CHAIR ARCHIVE 첫 배포"
```

```bash
git remote add origin https://github.com/<내 GitHub 아이디>/chair-archive.git
```

```bash
git push -u origin main
```

GitHub CLI(`gh`)가 이미 로그인되어 있으므로 1~2단계를 한 번에 할 수도 있다:

```bash
gh repo create chair-archive --public --source . --push
```

(위 명령은 `git init`·`git add`·`git commit` 후에 실행한다. 비공개로 만들려면 `--public` 대신 `--private`.)

### 4-2. Vercel 배포

1. https://vercel.com 에 GitHub 계정으로 로그인 (Hobby 플랜).
2. **Add New… → Project** → 방금 만든 `chair-archive` 저장소의 **Import**.
3. 설정은 `vercel.json`이 지정하므로 그대로 둔다: Framework `Vite`, Install `npm ci`, Build `npm run build`, Output `dist`. Root Directory는 저장소 최상위(기본값).
4. **Deploy**. 1~2분 뒤 `https://chair-archive-xxxx.vercel.app` 형태의 주소가 생긴다.
5. 이후에는 `git push` 할 때마다 자동으로 다시 배포된다.

### 4-3. 배포 후 확인할 주소

- `/` 메인 → 아래로 스크롤해 CHAIR DNA 전환, 버블 드래그·결합
- `/about.html`
- `/detail/001` ~ `/detail/007` 각각 주소창에 직접 입력 + 새로고침
- 상세 페이지에서 회전, 조립·분해, 휠 줌, 오른쪽 드래그 이동

## 5. 추가된 설정 파일

- `vercel.json`: 빌드 설정 + `/detail/NNN` → `detail.html` rewrite
- `.gitignore`: 위 2번의 제외 규칙
- `DEPLOY.md`: 이 문서
