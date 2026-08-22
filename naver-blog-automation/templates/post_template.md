---
post_id: "{{post_id}}"
channel: "{{channel_key}}"
channel_name: "{{channel_name}}"
blog_id: "{{blog_id}}"
publish_date: "{{publish_date}}"     # YYYY-MM-DD
publish_time: "{{publish_time}}"     # HH:MM (한국시간)
weekday: "{{weekday_ko}}"
slot: "{{slot}}"
status: draft

# 검색 키워드를 자연스럽게 반영한 제목 후보 3개
title_candidates:
  - "{{title_candidate_1}}"
  - "{{title_candidate_2}}"
  - "{{title_candidate_3}}"
# 위 셋 중 고른 최종 제목
title: "{{final_title}}"

category: "{{category}}"
keywords: [{{keywords}}]
hashtags: [{{hashtags}}]

# 이미지 삽입 위치와 설명 (본문의 [이미지:파일명] 표시와 짝을 맞춥니다)
images:
  - file: "{{image_file_1}}"
    position: 도입부 아래
    alt: "{{image_alt_1}}"
    kind: 대표이미지

# 시황·뉴스 글이면 자료 기준 시각을 반드시 채웁니다.
data_asof: "{{data_asof}}"           # 예: 2026-08-24 07:00 KST / 해당 없으면 null
sources_verified: false              # factcheck.py 가 채웁니다
style_analyzed: false                # 채널 양식 분석 완료 여부
---

{{intro}}

[이미지:{{image_file_1}}]

## {{heading_1}}

{{body_1}}

## {{heading_2}}

{{body_2}}

## {{heading_3}}

{{body_3}}

## 오늘 나온 말들

- **{{term_1}}** : {{term_1_desc}}
- **{{term_2}}** : {{term_2_desc}}

## 오늘 정리

- {{summary_1}}
- {{summary_2}}
- {{summary_3}}

{{reader_question}}

---

{{disclaimer}}

{{data_asof_line}}

{{hashtag_line}}
