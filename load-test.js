import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 50 },
    { duration: '20s', target: 100 },
    { duration: '20s', target: 200 },

    // 200人が普通にアプリを使っている状態
    { duration: '2m', target: 200 },

    { duration: '20s', target: 0 },
  ],

  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const BASE_URL = 'https://outing-2026.vercel.app';

const pages = [
  '/',
  '/guide',
  '/missions',
  '/stream',
  '/me',
];

export default function () {
  // 1人がどれか1ページを見る
  const page =
    pages[Math.floor(Math.random() * pages.length)];

  const res = http.get(`${BASE_URL}${page}`);

  check(res, {
    'status is OK': (r) =>
      r.status >= 200 && r.status < 400,

    'under 2 seconds': (r) =>
      r.timings.duration < 2000,
  });

  // 実際の参加者はページを読んだり写真を見たりするので
  // 3〜8秒待ってから次の操作
  sleep(3 + Math.random() * 5);
}