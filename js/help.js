// ヘルプ（図解）。色は CSS 変数を使うのでダークモードでもそのまま読める
const box = (x, y, w, h, title, sub = '', cls = '') => `
  <rect class="bx ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>
  <text class="t" x="${x + w / 2}" y="${y + (sub ? h / 2 - 4 : h / 2 + 5)}" text-anchor="middle">${title}</text>
  ${sub ? `<text class="s" x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle">${sub}</text>` : ''}`;
const arrow = (x1, y1, x2, y2, label = '', both = false) => `
  <line class="ar" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)" ${both ? 'marker-start="url(#ah)"' : ''}/>
  ${label ? `<text class="s" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" text-anchor="middle">${label}</text>` : ''}`;
const svg = (w, h, body, label) => `<div class="dg-wrap"><svg class="dg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker></defs>${body}</svg></div>`;

const TOC = [
  ['h-store', 'データの保存場所', 'ti-database'],
  ['h-sync', '同期のしくみ', 'ti-refresh'],
  ['h-files', '添付ファイルとドライブ', 'ti-paperclip'],
  ['h-remind', '交換・点検の目安', 'ti-tool'],
  ['h-fuel', '燃費の計算', 'ti-gas-station'],
  ['h-read', 'レシート・整備記録の読み取り', 'ti-scan'],
  ['h-words', '用語・表示の意味', 'ti-book'],
  ['h-faq', 'こんなときは', 'ti-help-circle'],
];

export function helpHtml() {
  const store = svg(640, 290, `
    ${box(10, 80, 150, 70, 'iPhone のアプリ', '端末の中に保存')}
    ${box(480, 80, 150, 70, 'PC のブラウザ', '端末の中に保存')}
    ${box(225, 14, 190, 76, 'スプレッドシート', '記録（records シート）', 'acc')}
    ${box(225, 140, 190, 76, 'Google ドライブ', '添付（専用フォルダ）', 'acc')}
    ${arrow(162, 100, 223, 60, '記録', true)}
    ${arrow(162, 132, 223, 172, '添付', true)}
    ${arrow(478, 100, 417, 60, '記録', true)}
    ${arrow(478, 132, 417, 172, '添付', true)}
    <text class="s" x="320" y="246" text-anchor="middle">端末ごと・ブラウザごとに保存場所は別。同期を設定すると全部がここで揃う</text>
    <text class="s" x="320" y="270" text-anchor="middle">同期なし ＝ その端末だけ（右上に「端末のみ」と表示）</text>`, 'データの保存場所の図');

  const sync = svg(640, 210, `
    ${box(10, 20, 130, 60, '記録を保存', '端末にすぐ保存')}
    ${arrow(142, 50, 178, 50, '2秒後')}
    ${box(180, 20, 130, 60, '変更分を送る', '前回の同期以降')}
    ${arrow(312, 50, 348, 50)}
    ${box(350, 20, 130, 60, 'シートで比較', '新しい方を残す', 'acc')}
    ${arrow(482, 50, 508, 50)}
    ${box(510, 20, 120, 60, '全件を受け取る', '端末も新しい方')}
    <text class="t" x="10" y="122">同期するタイミング</text>
    ${['アプリを開いたとき', '画面に戻ったとき', '保存・削除の2秒後', '同期ボタンを押したとき'].map((t, i) => `
      <rect class="bx chip" x="${10 + i * 157}" y="134" width="148" height="34" rx="17"/><text class="s" x="${84 + i * 157}" y="156" text-anchor="middle">${t}</text>`).join('')}
    <text class="s" x="10" y="196">同じ記録を2台で直したときは、後から保存した方が残ります。削除も他の端末に伝わります。</text>`, '同期の流れの図');

  const files = svg(640, 220, `
    ${box(10, 20, 140, 64, '撮影・選択', 'PDF / 写真')}
    ${arrow(152, 52, 188, 52)}
    ${box(190, 20, 130, 64, 'この端末に保存', '写真は縮小')}
    ${arrow(322, 52, 368, 52, '同期時')}
    ${box(370, 20, 130, 64, 'ドライブへ', '専用フォルダ', 'acc')}
    ${arrow(502, 52, 528, 52)}
    ${box(530, 20, 100, 64, '別の端末', '開いた時に取得')}
    ${box(10, 120, 300, 84, '', '', 'note')}
    <text class="s" x="22" y="146">・ドライブに上がると「ドライブ保存済」と表示</text>
    <text class="s" x="22" y="168">・添付を外して保存 → 次の同期でドライブのゴミ箱へ</text>
    <text class="s" x="22" y="190">・PDF は 15MB まで</text>
    ${box(330, 120, 300, 84, '', '', 'note')}
    <text class="s" x="342" y="146">・同期なしだと、付けた端末でしか開けません</text>
    <text class="s" x="342" y="168">・バックアップ（.json）に中身は入りません</text>
    <text class="s" x="342" y="190">・フォルダ名：のりもの維持費_添付</text>`, '添付ファイルの流れの図');

  const remind = svg(640, 170, `
    <line class="track" x1="40" y1="70" x2="600" y2="70"/>
    <line class="done" x1="40" y1="70" x2="380" y2="70"/>
    <circle class="dot" cx="40" cy="70" r="8"/><circle class="dot now" cx="380" cy="70" r="9"/><circle class="dot due" cx="600" cy="70" r="8"/>
    <text class="t" x="40" y="40" text-anchor="middle">前回の交換</text><text class="s" x="40" y="104" text-anchor="middle">56,310km</text><text class="s" x="40" y="122" text-anchor="middle">2026/2/26</text>
    <text class="t" x="380" y="40" text-anchor="middle">今</text><text class="s" x="380" y="104" text-anchor="middle">59,000km</text><text class="s" x="380" y="122" text-anchor="middle">（最新の ODO）</text>
    <text class="t" x="600" y="40" text-anchor="end">次回の目安</text><text class="s" x="600" y="104" text-anchor="end">61,310km</text><text class="s" x="600" y="122" text-anchor="end">2026/8/26</text>
    <text class="s" x="490" y="56" text-anchor="middle">あと 2,310km・あと 90日</text>
    <text class="s" x="40" y="158">例：エンジンオイル 5,000km／6か月ごと。距離と期間のうち先に来る方で「もうすぐ」「超過」を判定</text>`, '交換目安の図');

  const fuel = svg(640, 190, `
    ${box(10, 30, 150, 64, '満タン給油', 'ODO 10,000km')}
    ${box(245, 30, 150, 64, '継ぎ足し', '10L 入れた')}
    ${box(480, 30, 150, 64, '満タン給油', 'ODO 10,600km・20L')}
    ${arrow(162, 62, 243, 62)}${arrow(397, 62, 478, 62)}
    <text class="t" x="320" y="134" text-anchor="middle">燃費 ＝ 走った距離 ÷ その間に入れた量</text>
    <text class="s" x="320" y="158" text-anchor="middle">（10,600 − 10,000）÷（10 ＋ 20）＝ 20.0 km/L</text>
    <text class="s" x="320" y="180" text-anchor="middle">満タンから満タンまでで計算。継ぎ足しの量も足し込むので平均がずれません</text>`, '満タン法の図');

  const words = [
    ['愛車に費やした総額', 'ローン（車両の支払い）＋ 維持費。設定でローン額を入れると反映'],
    ['維持費', 'ガソリン・メンテ・カスタム・書類（保険・税）・コーティングの合計。カスタム計画（未購入）は含まない'],
    ['燃料費 /km・維持費 /km', '納車時の ODO（設定）から今までに走った距離 1km あたりの費用'],
    ['ODO', '総走行距離（メーターの数字）。給油・メンテの記録に入れた一番大きい値が「今」の距離'],
    ['継ぎ足し', '満タンにしなかった給油。燃費計算の区切りにはしない（量は次の満タンに足し込む）'],
    ['カスタム計画', '欲しい物リスト。「購入済みにする」でカスタム費用に移る'],
    ['13800+1290', '金額は式でも入力可。式はそのまま残るので内訳が分かる'],
    ['乗り物タブ', '上のタブで切り替え。記録・集計・Excel 取り込みは表示中の乗り物が対象'],
  ];
  const pills = [
    ['ti-cloud-off', '端末のみ', '同期していない。記録はこの端末（このブラウザ）だけにある'],
    ['ti-cloud-check', '同期済み', 'スプレッドシートと揃っている'],
    ['ti-cloud-upload', '未同期', 'まだ送っていない変更がある（数秒で自動送信）'],
    ['ti-cloud-x', '同期エラー', '通信できない・合言葉が違うなど。押すと再試行し、理由を表示'],
  ];
  const faq = [
    ['入れたはずの記録が無い', '別の端末・別のブラウザ・シークレットタブで入れた記録は、同期していないと見えません。iPhone は Safari で「ホーム画面に追加」したアプリから使うのが安定します。同期を設定すると全部の端末で揃います。'],
    ['添付が「別の端末にあり、まだ同期されていません」', '付けた端末でアプリを開くと自動でドライブへ上がります。その後なら他の端末でも開けます。'],
    ['読み取った数字が違う', '写真は明るく正面から、紙全体が入るように。PDF をそのまま使うと正確です。保存前に必ず確認・修正してください。'],
    ['目安が「記録なし」のまま', 'メンテ記録の実施項目に目安の言葉（例：オイル、ワイパー）が入っているか確認。言葉は設定の「メンテ時期のお知らせ」で変えられます。'],
    ['新しい版が出たのに画面が古い', 'アプリを一度閉じて開き直すか、ブラウザで再読み込みしてください。'],
  ];

  return `
  <div class="help">
    <div class="card help-toc">${TOC.map(([id, t, ic]) => `<button class="chip-btn" data-act="help-to" data-to="${id}"><i class="ti ${ic}" aria-hidden="true"></i>${t}</button>`).join('')}</div>

    <h2 id="h-store">データの保存場所</h2>
    <div class="card">${store}
      <p>記録はまず<b>今使っている端末（ブラウザ）の中</b>に保存されます。iPhone の Safari・iPhone の Chrome・PC の Chrome は<b>それぞれ別の保存場所</b>です。
      設定で「クラウド同期」をつなぐと、どの端末で入れた記録も Google スプレッドシートに集まり、全部の端末で同じ内容になります。端末のデータが消えても、同期していればスプレッドシートから戻ります。</p></div>

    <h2 id="h-sync">同期のしくみ</h2>
    <div class="card">${sync}
      <p>スプレッドシートは<b>自分の Google アカウント</b>の中にあり、Apps Script（Google の無料の仕組み）が窓口になります。URL と合言葉を知っている端末だけが読み書きできます。
      設定方法は手順書（SETUP.md）の 1 番。PC と iPhone に同じ URL と合言葉を入れれば完了です。</p></div>

    <h2 id="h-files">添付ファイルとドライブ</h2>
    <div class="card">${files}
      <p>整備記録・保証書・領収書などの PDF や写真を、どの記録にも付けられます。中身は端末に保存し、同期を設定していれば<b>あなたの Google ドライブ</b>の専用フォルダにも保存します（料金はかかりません。ドライブの空き容量を使います）。</p></div>

    <h2 id="h-remind">交換・点検の目安</h2>
    <div class="card">${remind}
      <p>「記録」画面の右側（スマホはメンテナンスのタブの上）とホームに表示します。前回はメンテ記録の<b>実施項目</b>に目安の言葉が入っている一番新しい記録です。
      距離・期間・言葉は <b>設定 → メンテ時期のお知らせ</b> で乗り物ごとに変えられます。</p>
      <p><b>車検</b>は設定の「初度登録年月」（車検証に書いてある年月）か「車検の満了日」から計算します。満了日の<b>2か月前から車検を受けられる</b>ので、3か月前から「予約の準備を」、2か月前から「予約しましょう」とホームに表示します。
      「Google カレンダーに登録」か「iPhone のカレンダー用」でカレンダーに入れておくと、アプリを開かなくても通知が来ます。250cc 以下のバイクなど車検が無い乗り物は、設定の「車検」が自動で「なし」になり、お知らせしません。</p>
      <div class="legend"><span class="rem over"><i class="ti ti-alert-triangle"></i>超過</span><span class="rem soon"><i class="ti ti-bell"></i>もうすぐ（500km か 30日以内）</span><span class="rem ok"><i class="ti ti-circle-check"></i>まだ大丈夫</span><span class="rem unknown"><i class="ti ti-help-circle"></i>記録なし</span></div></div>

    <h2 id="h-fuel">燃費の計算（満タン法）</h2>
    <div class="card">${fuel}</div>

    <h2 id="h-read">レシート・整備記録の読み取り</h2>
    <div class="card"><div class="two-col">
      <div><h3><i class="ti ti-gas-station"></i> 給油レシート</h3><p>ホームの「レシートで給油登録」→ 撮影。<b>金額・給油量・日付</b>を入れます。給油量×単価と金額が合えば「検算OK」。ODO は手入力。</p></div>
      <div><h3><i class="ti ti-tool"></i> 整備記録・請求書</h3><p>メンテの追加画面で「整備記録を撮影」か「PDF・写真から読み取る」。<b>日付・走行距離・合計・作業内容</b>を入れ、ファイルも添付します。作業ごとの金額は備考へ。</p></div>
    </div><p class="tiny">読み取りは端末の中で行います（外部に送らない・無料）。初回だけ部品をダウンロードします。PC は画面にファイルをドロップしても読み取れます。</p></div>

    <h2 id="h-words">用語・表示の意味</h2>
    <div class="card"><dl class="words">${words.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>
      <h3 style="margin-top:14px">右上の同期の表示</h3>
      <dl class="words">${pills.map(([ic, t, d]) => `<dt><i class="ti ${ic}"></i> ${t}</dt><dd>${d}</dd>`).join('')}</dl></div>

    <h2 id="h-faq">こんなときは</h2>
    <div class="card">${faq.map(([q, a]) => `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div>`;
}
