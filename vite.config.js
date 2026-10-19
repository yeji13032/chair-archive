import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// /detail/001 같은 의자별 주소를 detail.html로 연결한다 (개발·미리보기 서버).
// 배포 시에는 호스팅 쪽에도 같은 rewrite 규칙이 필요하다.
function detailRoutes() {
  const rewrite = (req, _res, next) => {
    if (/^\/detail\/\d{3}\/?(\?.*)?$/.test(req.url)) {
      req.url = '/detail.html';
    }
    next();
  };
  return {
    name: 'detail-routes',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

// MAIN / ABOUT / DETAIL 세 페이지를 각각 HTML 엔트리로 빌드한다.
export default defineConfig({
  plugins: [detailRoutes()],
  server: {
    open: true,
  },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        about: resolve(import.meta.dirname, 'about.html'),
        detail: resolve(import.meta.dirname, 'detail.html'),
      },
    },
  },
});
