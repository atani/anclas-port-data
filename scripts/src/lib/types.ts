/** アンクラスPort 正規化JSON の型定義 */

export const ANCLAS_TEAM_NAME = "福岡J・アンクラス";

/** 試合の状態 */
export type MatchStatus = "scheduled" | "finished";

/** ポジション */
export type Position = "GK" | "DF" | "MF" | "FW" | "FP";

/** 得点イベント（GoalNote game page 由来） */
export interface GoalEvent {
  /** "30分" / "55分(後半15分)" */
  minute: string;
  /** 得点したチーム名 */
  team: string;
  /** 背番号。OG なら null */
  playerNumber: number | null;
  /** 選手名。OG なら "オウンゴール" */
  playerName: string;
  /** "22→11S" などのアシスト/経過情報。無ければ null */
  assist: string | null;
}

/** 1試合 */
export interface Match {
  /** q-league の su-post id 由来の安定ID（例: "su-post-9354"） */
  id: string;
  /** 大会名（現状 "Qリーグ"） */
  competition: string;
  /** 節番号。HTMLから取れない場合 null */
  round: number | null;
  /** 試合日 YYYY-MM-DD */
  date: string;
  /** キックオフ HH:MM。未定なら null */
  kickoff: string | null;
  /** ISO8601（JST固定 +09:00）。kickoff が無い場合は日付の 00:00 */
  datetime: string;
  /** ホームチーム名（q-league 表記を正規化済み） */
  homeTeam: string;
  /** アウェイチーム名（正規化済み） */
  awayTeam: string;
  /** scheduled = 未消化（【vs】） / finished = 確定（【n-n】） */
  status: MatchStatus;
  /** 確定スコア。未消化なら null */
  score: { home: number; away: number } | null;
  /** ホーム・アウェイのいずれかがアンクラスか */
  isAnclas: boolean;
  /** q-league の試合詳細URL */
  sourceUrl: string;
  /** 会場名（GoalNote 由来）。未取得なら null */
  venue: string | null;
  /** 得点経過（GoalNote game page 由来）。未取得なら空配列 */
  goals: GoalEvent[];
  /** スタメン（GoalNote game page 由来）。未取得なら空配列 */
  starters: MatchPlayer[];
  /** 控え選手（GoalNote game page 由来）。未取得なら空配列 */
  subs: MatchPlayer[];
  /** 選手交代（GoalNote game page 由来）。未取得なら空配列 */
  substitutions: Substitution[];
  /** 試合情報（観客数・天候など）。未取得なら null */
  stats: { attendance: string | null; weather: string | null; temperature: string | null; pitch: string | null } | null;
  /** GoalNote の試合詳細URL。未取得なら null */
  goalnoteUrl: string | null;
  /** 試合告知ポスター画像URL（anclas.jp featured_media 由来）。無ければ null */
  posterUrl: string | null;
  /** マッチデープログラムPDF URL（ホームゲームのみ、anclas.jp uploads 由来）。無ければ null */
  matchdayProgramUrl: string | null;
  /** 警告・退場（GoalNote game page 由来）。未取得なら空配列 */
  cards: CardEvent[];
  /** マッチレポート（anclas.jp 由来）。未取得なら null */
  matchReport: MatchReport | null;
  /** フォトギャラリー画像URL（anclas.jp マッチレポート由来）。未取得なら空配列 */
  photoGallery: string[];
}

/** 試合のフォトギャラリー画像URL（anclas.jp マッチレポート由来） */
// Match.photoGallery: string[] として保持する

/** 得点ランキングの1行（GoalNote 由来。アンクラス選手のみ） */
export interface ScorerRank {
  /** チーム内（アンクラス内）での順位（1から振り直し） */
  rank: number;
  /** リーグ全体での順位（GoalNote 原典） */
  leagueRank: number;
  name: string;
  /** 背番号（選手名鑑と突き合わせ。取れなければ null） */
  number: number | null;
  goals: number;
}

/** 警告・退場（GoalNote game page 由来） */
export interface CardEvent {
  number: number;
  name: string;
  team: "home" | "away";
  /** "yellow" = 警告/ラフプレー / "red" = 退場 */
  type: "yellow" | "red";
}

/** 試合出場選手（GoalNote game page 由来） */
export interface MatchPlayer {
  number: number;
  position: Position;
  name: string;
  /** "home" = ホームチーム / "away" = アウェイチーム */
  team: "home" | "away";
}

/** 選手交代（GoalNote game page 由来） */
export interface Substitution {
  minute: string;
  team: "home" | "away";
  outNumber: number;
  outName: string;
  inNumber: number;
  inName: string;
}

/** マッチレポート（anclas.jp 由来） */
export interface MatchReport {
  summary: string;
  coachComment: { name: string; comment: string } | null;
  playerComments: { name: string; number: number | null; comment: string }[];
  sourceUrl: string;
}

/** matches.json のルート */
export interface MatchesData {
  /** 生成時刻 ISO8601 */
  generatedAt: string;
  /** シーズン年（試合日付の最頻年） */
  season: string;
  /** アプリのホーム画面でそのまま大きく出すための派生情報 */
  anclas: {
    /** 次の未消化アンクラス試合（最も近い未来）。無ければ null */
    nextMatch: Match | null;
    /** 直近の確定アンクラス試合（最も新しい過去）。無ければ null */
    latestResult: Match | null;
    /** ポッドキャスト最新エピソード。取得失敗時 null */
    latestPodcast: PodcastEpisode | null;
    /** YouTube 最新動画（通常動画）。取得失敗時 null */
    latestYouTube: YouTubeVideo | null;
    /** YouTube 最新ショート動画。取得失敗時 null */
    latestYouTubeShort: YouTubeVideo | null;
    /** 公式オンラインショップの商品（取得失敗時は空配列） */
    shopItems: ShopItem[];
  };
  /** アンクラスが所属する1部の全試合（節・日時順） */
  matches: Match[];
}

/** 順位表の1行 */
export interface StandingRow {
  rank: number;
  team: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  /** 総得点 goals for */
  gf: number;
  /** 総失点 goals against */
  ga: number;
  /** 得失点差 */
  gd: number;
  points: number;
  isAnclas: boolean;
}

/** アシストランキングの1行（試合データから自前集計） */
export interface AssistRank {
  rank: number;
  name: string;
  number: number | null;
  assists: number;
}

/** standings.json のルート */
export interface StandingsData {
  generatedAt: string;
  season: string;
  competition: string;
  table: StandingRow[];
  /** アンクラスの得点ランキング（GoalNote 由来）。未取得なら空配列 */
  scorers: ScorerRank[];
  /** アンクラスのアシストランキング（試合データから自前集計） */
  assists: AssistRank[];
}

/** 選手の写真サイズ別URL */
export interface PlayerPhoto {
  thumbnail: string | null;
  medium: string | null;
  large: string | null;
  full: string | null;
}

/** 選手の基本プロフィール（本文 <p> 由来） */
export interface PlayerProfile {
  birthdate: string | null;
  hometown: string | null;
  height: string | null;
  bloodType: string | null;
  career: string | null;
}

/** 1選手 */
export interface Player {
  /** WP 投稿ID */
  id: number;
  /** 背番号（タイトル #n 由来）。取れなければ null */
  number: number | null;
  /** ポジション（GoalNote 由来）。取れなければ null */
  position: Position | null;
  /** 漢字名 */
  nameJa: string;
  /** ローマ字名（大文字化）。取れなければ null */
  nameEn: string | null;
  /** ニックネーム。取れなければ null */
  nickname: string | null;
  photo: PlayerPhoto;
  profile: PlayerProfile;
  /** 本文 <table> 由来のパーソナル情報（ラベル・値の配列・表示順保持） */
  personal: { label: string; value: string }[];
  /** クラブ公式の選手ページURL */
  sourceUrl: string;
  /** 選手ブログ記事（anclas.jp 由来、新しい順） */
  blogPosts: BlogPost[];
  /** 公開SNSアカウント（手動管理、publicアカウントのみ） */
  sns: PlayerSns;
  /** キャプテン・副キャプテン（手動管理 player-roles.json 由来）。該当なしは null */
  role: PlayerRole | null;
}

/** 選手の役職 */
export type PlayerRole = "captain" | "vice_captain";

/** 選手の公開SNSアカウント */
export interface PlayerSns {
  instagram?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
}

/** 選手ブログ記事 */
export interface BlogPost {
  title: string;
  url: string;
  date: string;
}

/** オンラインショップの商品 */
export interface ShopItem {
  id: string;
  name: string;
  price: string;
  imageUrl: string;
  url: string;
}

/** YouTube 最新動画 */
export interface YouTubeVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  url: string;
  publishedAt: string;
}

/** ポッドキャスト最新エピソード */
export interface PodcastEpisode {
  title: string;
  thumbnailUrl: string;
  showUrl: string;
  embedUrl: string;
  /** エピソード公開日 YYYY-MM-DD。取得できなければ null */
  publishedAt: string | null;
}

/** players.json のルート */
export interface PlayersData {
  generatedAt: string;
  /** カテゴリ名から抽出したシーズン年（例: "2026"） */
  season: string;
  players: Player[];
}

/** オフィシャルパートナー1社（anclas.jp トップページ由来） */
export interface Partner {
  /** 表示名（img alt かロゴファイル名から補完。UI では使わず best-effort） */
  name: string;
  /** パートナーのリンク先URL。サイト側で未設定なら空文字 */
  url: string;
  /** ロゴ画像URL（anclas.jp uploads、lazyload の data-src 由来） */
  logoUrl: string;
}

/** partners.json のルート */
export interface PartnersData {
  generatedAt: string;
  partners: Partner[];
}
