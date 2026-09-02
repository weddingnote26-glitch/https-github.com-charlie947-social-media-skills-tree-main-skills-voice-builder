/**
 * 오늘의 릴스 — 4대 분류.
 *
 * 맛집 이름을 바로 넣는 대신 "무슨 이야기를 할지" 부터 고르게 한다.
 * 각 분류를 누르면 세부 주제 추천 화면(/topics/분류)으로 간다.
 * 화면과 서버가 같은 목록을 쓰도록 여기 한 곳에만 둔다 (순수 모듈 — 시험에서 직접 확인).
 */
export interface TopicCategory {
  key: string;
  icon: string;
  label: string;
  /** 분류 아래에 작게 보여 주는 설명 */
  hint: string;
  /** 연습 모드·키 없음일 때 보여 줄 예시 주제 (AI 를 부르지 않는다) */
  examples: string[];
}

export const TOPIC_CATEGORIES: readonly TopicCategory[] = [
  {
    key: "daily", icon: "🧑‍🤝‍🧑", label: "일상 · 관계", hint: "친구, 주말, 새로운 시작",
    examples: [
      "주말에 친구랑 갈 만한 신림 밥집", "혼자 밥 먹기 편한 동네 식당", "새 직장 첫 주, 점심 고민 해결",
      "부모님 모시고 가기 좋은 한 끼", "퇴근길에 들르는 작은 위로", "오랜만에 만난 친구와 저녁",
    ],
  },
  {
    key: "town", icon: "🍽", label: "동네 · 맛집", hint: "새로 생긴 가게, 골목 맛집",
    examples: [
      "동네에 새로 생긴 맛집 추가", "10년 넘게 자리 지킨 골목 식당", "가격 대비 양이 푸짐한 집",
      "점심에만 줄 서는 곳", "메뉴 하나로 승부하는 가게", "반전 있는 숨은 맛집",
    ],
  },
  {
    key: "hobby", icon: "🎨", label: "생활 취미", hint: "산책, 요리, 만들기, 작은 도전",
    examples: [
      "산책 끝에 들르는 간식집", "집에서 따라 해 보는 동네 식당 메뉴", "주말 아침 빵집 순례",
      "운동 뒤 단백질 한 끼", "카페 대신 가는 디저트 가게", "새로운 메뉴 하나 도전하기",
    ],
  },
  {
    key: "brand", icon: "🥟", label: "오락 브랜딩 (소개)", hint: "오락이·오락푸드 소개, 세계관",
    examples: [
      "만두탐정 오락이는 누구인가", "오락푸드가 맛집을 고르는 기준", "맛집 사건 파일 시리즈 소개",
      "오락이의 탐정 판정, 어떻게 매기나", "신림 골목을 조사하는 이유", "오락푸드 주 6회 발행 약속",
    ],
  },
];

export function findCategory(key: string): TopicCategory | undefined {
  return TOPIC_CATEGORIES.find((c) => c.key === String(key ?? "").trim());
}
