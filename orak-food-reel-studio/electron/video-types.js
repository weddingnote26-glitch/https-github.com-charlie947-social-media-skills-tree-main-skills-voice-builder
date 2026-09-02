"use strict";
/**
 * 파일 고르기 창이 보여 주는 영상 형식.
 * 서버 쪽 검사(src/lib/pipeline/imported-video.ts 의 VIDEO_EXTENSIONS)와 같은 목록이어야 한다 —
 * 자동 테스트가 두 목록이 같은지 확인한다.
 */
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv"];

module.exports = { VIDEO_EXTENSIONS };
