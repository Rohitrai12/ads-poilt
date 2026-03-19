'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

type Tab = 'meta' | 'google' | 'tiktok'

export default function Home() {
  const [scrolled, setScrolled] = useState(false)
  const [tab, setTab] = useState<Tab>('meta')
  const [annual, setAnnual] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const chartRef = useRef<SVGSVGElement>(null)

   useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://api.leadconnectorhq.com/js/form_embed.js";
    script.async = true;
    document.body.appendChild(script);
  }, []); 

  /* ── nav scroll ── */
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  /* ── reveal on scroll ── */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
      { threshold: 0.15 },
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  /* ── hero chat animation ── */
  useEffect(() => {
    const show = (id: string, delay: number) =>
      setTimeout(() => {
        const el = document.getElementById(id)
        if (!el) return
        if (id === 'typingRow') { el.style.display = 'none'; return }
        el.style.display = 'flex'
        el.style.animation = 'slideIn 0.4s ease forwards'
      }, delay + 800)

    const timers = [
      show('typingRow', 2000),
      show('zofiReply', 2000),
      show('userYes', 3500),
      show('zofDone', 4800),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  /* ── KPI count-up + chart draw ── */
  useEffect(() => {
    const grid = document.getElementById('kpiGrid')
    if (!grid) return
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      chartRef.current?.classList.add('animate')
      document.querySelectorAll<HTMLElement>('[data-target]').forEach((el) => {
        const target = parseFloat(el.dataset.target!)
        const prefix = el.dataset.prefix ?? ''
        const suffix = el.dataset.suffix ?? ''
        const dec = String(target).includes('.')
        const t0 = Date.now()
        const tick = () => {
          const p = Math.min((Date.now() - t0) / 1800, 1)
          const v = target * (1 - Math.pow(1 - p, 3))
          el.textContent = prefix + (dec ? v.toFixed(1) : Math.floor(v)) + suffix
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      io.disconnect()
    }, { threshold: 0.15 })
    io.observe(grid)
    return () => io.disconnect()
  }, [])

  const prices = annual ? ['0', '39', '119'] : ['0', '49', '149']

  const faqs = [
    ['Do I need any technical skills to use Zofi?', 'None at all. If you can send a text message, you can use Zofi. You connect your ad accounts with one click, and everything else is just a conversation. Zofi handles all the technical parts behind the scenes.'],
    ['Is my ad account data safe?', 'Yes. Zofi connects to your accounts using OAuth — the same secure method used by apps like Slack and Notion. We never store your passwords. Your data is encrypted and never shared with third parties. You can disconnect at any time.'],
    ['Can Zofi make changes to my campaigns without asking?', 'No. Zofi always asks for your confirmation before making any changes. She will tell you exactly what she plans to do and why. You approve it. She executes it. Every action is logged and reversible with one click.'],
    ['What ad platforms does Zofi support?', 'Zofi currently supports Meta Ads (Facebook + Instagram), Google Ads (Search, Shopping, Display, YouTube), and TikTok Ads. Pinterest and Snapchat are coming in late 2026.'],
    ['How is Zofi different from Meta Ads Manager or Google Ads?', 'Meta and Google only show you their own data in their own complicated dashboards. Zofi shows you all three platforms together, in plain English, with AI analysis that tells you exactly what to do. It\'s like having a senior media buyer who monitors everything 24/7.'],
    ['Do you offer a free trial?', 'Yes — all paid plans include a 14-day free trial with full access to every feature. No credit card required to start. You only pay after the trial if you choose to continue.'],
  ]

  return (
    <>
      {/* NAV */}
      <nav id="nav" className={scrolled ? 'scrolled' : ''}>
        <div className="nav-logo">
          {/* <div className="z-icon">Z</div>
          Zofi */}

          <Image src={"/logo-with-text.png"} alt="logo" width={150} height={150} style={{borderRadius:"50%"}}/>
        </div>
        <ul className="nav-links">
          {['Features', 'Platforms', 'KPIs', 'Chat', 'Pricing'].map((l) => (
            <li key={l}><a href={`#${l.toLowerCase()}`}>{l}</a></li>
          ))}
        </ul>
        <div className="nav-right">
          <a href="/login" className="nav-login">Login</a>
          <a href="/singup"><button className="btn-nav">Start Free →</button></a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="hero">
        <div className="hero-blob2" />
        <div className="hero-inner">
          <div className="hero-left">
            <div className="hero-badge">
              <div className="badge-dot" />
              Powered by Advanced AI &nbsp;•&nbsp; Meta + Google + TikTok
            </div>
            <h1 className="hero-headline">
              The AI That Runs<br />
              Your Ads <span className="accent">Better</span><br />
              Than Any Human
            </h1>
            <p className="hero-sub">
              Zofi connects to your Meta, Google, and TikTok ad accounts. She analyses every campaign, spots wasted budget, and fixes your ads — just by having a conversation with her.<br /><br />
              No expertise needed. No agency required. Just results.
            </p>
            <div className="hero-btns">
              <button className="btn-primary">Chat With Zofi Free →</button>
              <button className="btn-secondary">▶ Watch 2-Min Demo</button>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars">
                <div className="proof-avatar" style={{ background: '#6C47FF' }}>S</div>
                <div className="proof-avatar" style={{ background: '#00C9A7' }}>A</div>
                <div className="proof-avatar" style={{ background: '#FF6B6B' }}>M</div>
                <div className="proof-avatar" style={{ background: '#F59E0B' }}>J</div>
              </div>
              <div>
                <div className="proof-stars">★★★★★</div>
                <div className="proof-text">Trusted by <strong>2,400+</strong> businesses on Meta, Google &amp; TikTok</div>
              </div>
            </div>
          </div>

          {/* Dashboard Mockup */}
          <div className="dashboard-wrap">
            <div className="dashboard">
              <div className="dash-bar">
                <div className="dot-r" /><div className="dot-y" /><div className="dot-g" />
                <span className="dash-title">Zofi Dashboard</span>
              </div>
              <div className="dash-metrics">
                <div className="dash-metric">
                  <div className="dm-label">ROAS</div>
                  <div className="dm-val up">4.2x ↑</div>
                  <div className="dm-change">+0.8 this week</div>
                </div>
                <div className="dash-metric">
                  <div className="dm-label">Total Spend</div>
                  <div className="dm-val white">$12,840</div>
                  <div className="dm-change">3 platforms</div>
                </div>
                <div className="dash-metric">
                  <div className="dm-label">Saved</div>
                  <div className="dm-val up">$420 ↓</div>
                  <div className="dm-change">wasted budget</div>
                </div>
              </div>
              <div className="dash-chat" id="dashChat">
                <div className="chat-msg user" style={{ animationDelay: '0.4s' }}>
                  <div className="chat-avatar user">U</div>
                  <div className="chat-bubble user">Which campaign is wasting my budget?</div>
                </div>
                <div className="chat-msg" id="typingRow" style={{ animationDelay: '0.9s' }}>
                  <div className="chat-avatar zofi">Z</div>
                  <div className="typing-indicator">
                    <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                  </div>
                </div>
                <div className="chat-msg" id="zofiReply" style={{ display: 'none' }}>
                  <div className="chat-avatar zofi">Z</div>
                  <div className="chat-bubble zofi">
                    Your Google Shopping campaign spent $840 with only 2 conversions. Meta retargeting is getting 6.1x ROAS on the same budget. Move the $840?
                    <div className="action-done">✓ 3 optimisations ready to apply</div>
                  </div>
                </div>
                <div className="chat-msg user" id="userYes" style={{ display: 'none' }}>
                  <div className="chat-avatar user">U</div>
                  <div className="chat-bubble user">Yes, do it</div>
                </div>
                <div className="chat-msg" id="zofDone" style={{ display: 'none' }}>
                  <div className="chat-avatar zofi">Z</div>
                  <div className="chat-bubble zofi">
                    <div className="action-done">✓ Paused Google Shopping — saving $120/day</div>
                    <div className="action-done">✓ Meta retargeting budget → $1,200/week</div>
                  </div>
                </div>
              </div>
              <div className="dash-pills">
                <span className="dash-pill dp-mint">↑ 6.1x ROAS</span>
                <span className="dash-pill dp-coral">↓ $420 saved</span>
                <span className="dash-pill dp-violet">✓ 3 actions</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <div className="marquee-section">
        <div className="marquee-inner" id="marquee">
          {Array(2).fill(['Meta Ads', 'Google Ads', 'TikTok Ads', 'Facebook Pixel', 'Google Analytics', 'Google Tag Manager', 'Shopify', 'WooCommerce', 'TikTok Pixel', 'Meta Business Suite']).flat().map((item, i) => (
            <span key={i} className="marquee-item">{item} <span className="sep">•</span></span>
          ))}
        </div>
      </div>

      {/* PROBLEM */}
      <section className="problem" id="features">
        <div className="section-inner">
          <div className="reveal">
            <div className="section-label label-coral">The Problem</div>
            <h2 className="section-headline">Running ads on 3 platforms<br />is complicated, expensive<br />and exhausting.</h2>
            <p className="section-sub">Most business owners waste 30–40% of their ad budget because they can&apos;t monitor everything at once. Agencies charge $2,000+/month.</p>
          </div>
          <div className="problem-grid">
            {[
              { delay: 'reveal-delay-1', icon: '😤', title: "You're flying blind", body: "You're spending money on Meta, Google, and TikTok but have no idea which platform is actually working. The dashboards don't talk to each other." },
              { delay: 'reveal-delay-2', icon: '💸', title: 'Budget is being wasted right now', body: 'While you sleep, underperforming campaigns keep spending. By the time you notice, hundreds or thousands of dollars are gone.' },
              { delay: 'reveal-delay-3', icon: '⏰', title: "There aren't enough hours", body: "Checking three ad platforms, reading confusing reports, making manual changes — it takes hours every week that you just don't have." },
            ].map(({ delay, icon, title, body }) => (
              <div key={title} className={`problem-card reveal ${delay}`}>
                <div className="problem-icon">{icon}</div>
                <div className="problem-title">{title}</div>
                <div className="problem-body">{body}</div>
              </div>
            ))}
          </div>
          <div className="problem-strip reveal">
            The average Zofi customer was wasting <strong> 38% of their ad budget </strong> before connecting their accounts.
          </div>
        </div>
      </section>

      {/* PLATFORMS */}
      <section className="platforms" id="platforms">
        <div className="section-inner">
          <div className="reveal">
            <div className="section-label label-violet">Platforms</div>
            <h2 className="section-headline">Zofi works with every<br />major ad platform</h2>
          </div>
          <div className="platform-tabs reveal">
            {([['meta', '📘 Meta Ads'], ['google', '🔍 Google Ads'], ['tiktok', '🎵 TikTok Ads']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} className={`ptab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {/* Meta */}
          <div className={`platform-panel${tab === 'meta' ? ' active' : ''}`} id="tab-meta">
            <ul className="platform-features">
              {['Connect Facebook & Instagram via secure OAuth', 'View all campaigns, ad sets, and individual ads', 'Pause, activate, and edit budgets in one click', 'Full Facebook Pixel tracking — purchases, add to carts, page views', 'Audience insights — who\'s buying, age, gender, location', 'Creative performance — which image or video is winning', 'Lookalike audience creation from your top buyers', 'Cross-campaign budget reallocation via AI chat'].map(f => (
                <li key={f} className="pf-item"><span className="pf-check">✓</span> {f}</li>
              ))}
            </ul>
            <div className="platform-mockup">
              <div className="mock-header">Meta Campaigns <span className="mock-status">● Live — synced 2 min ago</span></div>
              <div className="mock-row head"><div>Campaign</div><div>Spend</div><div>ROAS</div><div>Status</div></div>
              <div className="mock-row"><div className="mock-name">Eid Collection</div><div className="mock-val">$3,120</div><div className="mock-roas-good">6.1x</div><div><span className="status-active">Active</span></div></div>
              <div className="mock-row"><div className="mock-name">Brand Awareness</div><div className="mock-val">$1,200</div><div className="mock-roas-bad">0.8x</div><div><span className="status-paused">Paused</span></div></div>
              <div className="mock-row"><div className="mock-name">Retargeting — Web</div><div className="mock-val">$840</div><div className="mock-roas-good">4.8x</div><div><span className="status-active">Active</span></div></div>
              <div className="mock-row"><div className="mock-name">Lookalike — Buyers</div><div className="mock-val">$620</div><div className="mock-roas-good">5.2x</div><div><span className="status-active">Active</span></div></div>
            </div>
          </div>

          {/* Google */}
          <div className={`platform-panel${tab === 'google' ? ' active' : ''}`} id="tab-google">
            <ul className="platform-features">
              {['Connect Search, Shopping, Display, and YouTube campaigns', 'Keyword performance analysis — which keywords are wasting money', 'Quality Score monitoring and improvement recommendations', 'Ad copy editing via chat — "Rewrite my headline"', 'Bid strategy optimisation per campaign type', 'Google Tag & Conversion tracking integration', 'Search term report — what people actually searched', 'Negative keyword suggestions to stop wasted clicks'].map(f => (
                <li key={f} className="pf-item"><span className="pf-check">✓</span> {f}</li>
              ))}
            </ul>
            <div className="platform-mockup">
              <div className="mock-header">Google Keywords <span className="mock-status">● Live</span></div>
              <div className="mock-row head"><div>Keyword</div><div>CPC</div><div>Conv%</div><div>Action</div></div>
              <div className="mock-row"><div className="mock-name">buy shoes online</div><div className="mock-val">$0.84</div><div className="mock-roas-good">4.2%</div><div><span className="status-active">Keep</span></div></div>
              <div className="mock-row"><div className="mock-name">shoes</div><div className="mock-val">$2.40</div><div className="mock-roas-bad">0.3%</div><div><span className="status-paused">Pause</span></div></div>
              <div className="mock-row"><div className="mock-name">women sneakers</div><div className="mock-val">$1.20</div><div className="mock-roas-good">3.8%</div><div><span className="status-active">Keep</span></div></div>
              <div className="mock-row"><div className="mock-name">footwear</div><div className="mock-val">$1.90</div><div className="mock-roas-bad">0.6%</div><div><span className="status-paused">Review</span></div></div>
            </div>
          </div>

          {/* TikTok */}
          <div className={`platform-panel${tab === 'tiktok' ? ' active' : ''}`} id="tab-tiktok">
            <ul className="platform-features">
              {['Connect TikTok Business accounts in one click', 'Video ad performance — views, watch time, swipe-ups', 'TikTok Pixel tracking — purchases, sign-ups, app installs', 'Creative fatigue alerts — know when to refresh your video', 'Video completion rate and engagement rate monitoring', 'Audience targeting — interests, behaviours, custom audiences', 'Budget management across campaigns and ad groups', 'Cross-platform attribution with Meta and Google'].map(f => (
                <li key={f} className="pf-item"><span className="pf-check">✓</span> {f}</li>
              ))}
            </ul>
            <div className="platform-mockup">
              <div className="mock-header">TikTok Videos <span className="mock-status">● Live</span></div>
              <div className="mock-row head"><div>Creative</div><div>CPM</div><div>Completion</div><div>ROAS</div></div>
              <div className="mock-row"><div className="mock-name">Unboxing Video</div><div className="mock-val">$8.20</div><div className="mock-roas-bad">41% ⚠️</div><div className="mock-roas-bad">2.1x</div></div>
              <div className="mock-row"><div className="mock-name">Product Demo</div><div className="mock-val">$6.80</div><div className="mock-roas-good">68%</div><div className="mock-roas-good">4.4x</div></div>
              <div className="mock-row"><div className="mock-name">Customer UGC</div><div className="mock-val">$5.40</div><div className="mock-roas-good">74%</div><div className="mock-roas-good">5.1x</div></div>
              <div className="mock-row"><div className="mock-name">Trending Sound</div><div className="mock-val">$7.10</div><div className="mock-roas-good">61%</div><div className="mock-roas-good">3.8x</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="kpi-section" id="kpis">
        <div className="section-inner">
          <div className="reveal">
            <div className="section-label label-mint">KPIs &amp; Tracking</div>
            <h2 className="section-headline">The metrics dashboard that<br />changes how you see your ads.</h2>
            <p className="section-sub">Zofi shows you KPIs that other platforms hide, combine, or don&apos;t even know exist.</p>
          </div>
          <div className="kpi-metrics reveal" id="kpiGrid">
            <div className="kpi-card"><div className="kpi-label">Cross-Platform ROAS</div><div className="kpi-num mint" data-target="4.2" data-suffix="x">0x</div><div className="kpi-change good">↑ +0.8 this week</div></div>
            <div className="kpi-card"><div className="kpi-label">Total Spend</div><div className="kpi-num" data-target="12840" data-prefix="$">$0</div><div className="kpi-change">3 platforms</div></div>
            <div className="kpi-card"><div className="kpi-label">True CPA</div><div className="kpi-num mint" data-target="18.40" data-prefix="$">$0</div><div className="kpi-change good">↓ $4.20 better</div></div>
            <div className="kpi-card"><div className="kpi-label">Wasted Budget</div><div className="kpi-num mint" data-target="0" data-prefix="$">$420</div><div className="kpi-change good">↓ from $420</div></div>
            <div className="kpi-card"><div className="kpi-label">Active Campaigns</div><div className="kpi-num" data-target="14">0</div><div className="kpi-change">across all platforms</div></div>
            <div className="kpi-card"><div className="kpi-label">Pixel Health</div><div className="kpi-num mint" data-target="94" data-suffix="/100">0/100</div><div className="kpi-change good">↑ +6 pts</div></div>
          </div>
          <div className="chart-wrap reveal">
            <div className="chart-header">
              <div className="chart-title">ROAS by Platform — Last 7 Days</div>
              <div className="chart-legend">
                <div className="legend-item"><div className="legend-dot" style={{ background: '#6C47FF' }} /> Meta</div>
                <div className="legend-item"><div className="legend-dot" style={{ background: '#00C9A7' }} /> Google</div>
                <div className="legend-item"><div className="legend-dot" style={{ background: '#FF6B6B' }} /> TikTok</div>
              </div>
            </div>
            <svg className="chart-svg" ref={chartRef} id="chartSvg" viewBox="0 0 900 140" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gMeta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6C47FF" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#6C47FF" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="30" x2="900" y2="30" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <line x1="0" y1="70" x2="900" y2="70" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <line x1="0" y1="110" x2="900" y2="110" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <polyline className="chart-line-meta" points="0,90 130,75 260,55 390,40 520,30 650,25 780,30 900,20" />
              <polyline className="chart-line-google" points="0,100 130,95 260,85 390,80 520,75 650,70 780,68 900,65" />
              <polyline className="chart-line-tiktok" points="0,110 130,100 260,95 390,88 520,82 650,78 780,72 900,70" />
              <circle cx="900" cy="20" r="4" fill="#6C47FF" />
              <circle cx="900" cy="65" r="4" fill="#00C9A7" />
              <circle cx="900" cy="70" r="4" fill="#FF6B6B" />
            </svg>
          </div>
          <div className="kpi-unique reveal">
            {[
              { icon: '🔀', title: 'Cross-Platform Attribution', body: 'Track customers who saw a TikTok ad, searched Google, then bought from a Meta retargeting ad. Know the full journey, not just the last click.' },
              { icon: '🎯', title: 'Budget Efficiency Score', body: 'A single score (0–100) showing what percentage of your ad spend is actually working. Below 70? Zofi automatically intervenes.' },
              { icon: '🔥', title: 'Creative Fatigue Index', body: 'Zofi monitors ad frequency and engagement drop-off to tell you exactly when to refresh your creative before ROAS tanks.' },
              { icon: '💰', title: 'True Profit ROAS', body: "Connect your product costs and Zofi calculates real profit ROAS — not just revenue ROAS. Know if you're actually making money." },
            ].map(({ icon, title, body }) => (
              <div key={title} className="kpi-unique-card">
                <div className="ku-icon">{icon}</div>
                <div className="ku-title">{title}</div>
                <div className="ku-body">{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHAT SHOWCASE */}
      <section className="chat-section" id="chat">
        <div className="section-inner">
          <div className="reveal">
            <h2 className="section-headline">Meet Zofi.<br />She runs your ads.<br />You just talk to her.</h2>
            <p className="section-sub">No training. No manuals. No complicated menus. Just tell her what you want — she gets it done.</p>
          </div>
          <div className="chat-showcase reveal">
            <div className="cs-header">
              <div className="cs-avatar">Z</div>
              <div className="cs-info">
                <div className="cs-name">Zofi</div>
                <div className="cs-role">AI Media Buyer · Meta, Google &amp; TikTok</div>
              </div>
              <div className="cs-online"><div className="cs-online-dot" /> Online</div>
            </div>
            <div className="cs-body">
              <div className="cs-msg"><div className="cs-msg-avatar z">Z</div><div className="cs-bubble z">Hi! I&apos;ve finished analysing your accounts. You have 14 active campaigns across Meta, Google, and TikTok. Your overall ROAS is 4.2x — up from 3.4x last week. I found 3 issues that need attention. Want me to walk you through them?</div></div>
              <div className="cs-msg user"><div className="cs-msg-avatar u">U</div><div className="cs-bubble u">What happened to my ROAS this week?</div></div>
              <div className="cs-msg"><div className="cs-msg-avatar z">Z</div><div className="cs-bubble z">Your ROAS improved from 3.4x to 4.2x. The main driver: your Meta retargeting campaign picked up momentum after the audience change. However, your Google Shopping campaign started targeting broad match keywords on Monday — it tripled your clicks but dropped conversion rate from 4.2% to 1.1%. Want me to fix the Google targeting?<div className="cs-action">⚡ Estimated saving: $180/day if fixed now</div></div></div>
              <div className="cs-msg user"><div className="cs-msg-avatar u">U</div><div className="cs-bubble u">Yes fix it. Also check if my TikTok creative is getting tired</div></div>
              <div className="cs-msg"><div className="cs-msg-avatar z">Z</div><div className="cs-bubble z"><div className="cs-action">✓ Paused 14 broad match keywords in Google Shopping</div><div className="cs-action">✓ Restored exact match targeting — saving ~$180/day</div><br />For TikTok: your top video (product unboxing) has been running 23 days. Watch completion dropped from 68% to 41% — classic creative fatigue. Your other two TikTok videos are still fresh. I recommend uploading a new video this week.</div></div>
              <div className="cs-msg user"><div className="cs-msg-avatar u">U</div><div className="cs-bubble u">What&apos;s my best performing audience across all 3 platforms?</div></div>
              <div className="cs-msg"><div className="cs-msg-avatar z">Z</div><div className="cs-bubble z">Across all platforms, your best audience is: Women 25–34, fashion &amp; online shopping interests, mobile devices. This segment generates 4x the ROAS of your average audience. I can create a 1% lookalike of this audience on Meta and TikTok right now. Want me to?</div></div>
              <div className="cs-msg user"><div className="cs-msg-avatar u">U</div><div className="cs-bubble u">Create it on Meta and increase their budget by $50/day</div></div>
              <div className="cs-msg"><div className="cs-msg-avatar z">Z</div><div className="cs-bubble z"><div className="cs-action">✓ Created lookalike audience (1%) on Meta — 1.2M reach</div><div className="cs-action">✓ Meta retargeting budget: $80 → $130/day</div><br />Both are live. I&apos;ll monitor performance and send you an update in 48 hours. Projected ROAS improvement: +0.6x based on similar audience tests.</div></div>
            </div>
            <div className="cs-suggestions">
              {['How much did I spend on TikTok?', 'Pause my worst campaign', "What's my best performing ad?", 'Generate my weekly report', 'Why is my CPM so high?'].map(c => (
                <span key={c} className="cs-chip">{c}</span>
              ))}
            </div>
            <div className="cs-input-row">
              <input className="cs-input" type="text" placeholder="Ask Zofi anything about your ads..." />
              <button className="cs-send">→</button>
            </div>
          </div>
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px', color: 'var(--gray400)' }}>Every action Zofi takes is logged. You can undo any change in one click.</p>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing" id="pricing">
        <div className="section-inner">
          <div className="reveal" style={{ textAlign: 'center' }}>
            <div className="section-label label-violet" style={{ margin: '0 auto 16px' }}>Pricing</div>
            <h2 className="section-headline" style={{ textAlign: 'center' }}>Simple pricing.<br />No agency fees.</h2>
            <p className="section-sub" style={{ textAlign: 'center', margin: '0 auto' }}>Start free. Upgrade when Zofi has paid for herself ten times over.</p>
          </div>
          <div className="pricing-toggle reveal">
            <span className="toggle-label">Monthly</span>
            <div className="toggle-track" onClick={() => setAnnual(!annual)}>
              <div className="toggle-thumb" style={{ transform: annual ? 'translateX(22px)' : 'translateX(0)' }} />
            </div>
            <span className="toggle-label">Annual <span className="toggle-badge">Save 20%</span></span>
          </div>
          <div className="pricing-grid reveal">
            {/* Free */}
            <div className="pricing-card">
              <div className="price-plan">Free</div>
              <div className="price-num"><sup>$</sup>{prices[0]}<span>/mo</span></div>
              <div className="price-desc">Perfect to get started. No credit card required.</div>
              <button className="price-btn price-btn-outline">Get Started Free</button>
              <ul className="price-features">
                {['1 Ad Account', '1 Platform (Meta, Google, or TikTok)', '50 AI messages/month', 'Basic campaign overview', '1 AI report/month'].map(f => <li key={f} className="pf"><span className="pf-icon-ok">✓</span> {f}</li>)}
                {['Cross-platform dashboard', 'Campaign edits via AI'].map(f => <li key={f} className="pf"><span className="pf-icon-no">✗</span> {f}</li>)}
              </ul>
            </div>
            {/* Pro */}
            <div className="pricing-card featured">
              <div className="popular-badge">✦ Most Popular</div>
              <div className="price-plan" style={{ color: 'var(--violet)' }}>Pro</div>
              <div className="price-num" style={{ color: 'var(--violet)' }}><sup>$</sup>{prices[1]}<span>/mo</span></div>
              <div className="price-desc">Everything you need to grow. Most customers 5x their ROAS.</div>
              <button className="price-btn price-btn-filled">Start Pro — 14 Days Free</button>
              <ul className="price-features">
                {['5 Ad Accounts', 'All 3 platforms: Meta + Google + TikTok', 'Unlimited AI messages', 'Cross-platform dashboard', 'Weekly AI performance reports', 'Full campaign control', 'PDF export + email reports'].map(f => <li key={f} className="pf"><span className="pf-icon-ok">✓</span> {f}</li>)}
              </ul>
            </div>
            {/* Agency */}
            <div className="pricing-card" style={{ background: 'var(--navy)' }}>
              <div className="price-plan" style={{ color: 'rgba(255,255,255,0.4)' }}>Agency</div>
              <div className="price-num" style={{ color: 'white' }}><sup>$</sup>{prices[2]}<span style={{ color: 'rgba(255,255,255,0.4)' }} />/mo</div>
              <div className="price-desc" style={{ color: 'rgba(255,255,255,0.5)' }}>Manage every client from one place. White-label reports included.</div>
              <button className="price-btn" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}>Start Agency Free</button>
              <ul className="price-features">
                {['Unlimited Ad Accounts', 'All 3 platforms', 'Unlimited AI messages', 'White-label branded reports', 'Multi-client dashboard', 'Dedicated onboarding call', 'Slack support channel'].map(f => <li key={f} className="pf" style={{ color: 'rgba(255,255,255,0.6)' }}><span className="pf-icon-ok">✓</span> {f}</li>)}
              </ul>
            </div>
          </div>
          <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--gray400)' }}>All plans include a 14-day free trial. No credit card required. Cancel anytime.</p>
        </div>
      </section>

 <iframe
        src="https://api.leadconnectorhq.com/widget/booking/imHBwrekjl9SvyG9tV52"
        style={{ width: "100%", border: "none", overflow: "hidden" }}
        scrolling="no"
        id="imHBwrekjl9SvyG9tV52_1773827461376"
      />
      {/* FAQ */}
      <section className="faq">
        <div className="section-inner" style={{ maxWidth: '900px' }}>
          <div className="reveal" style={{ textAlign: 'center' }}>
            <h2 className="section-headline" style={{ textAlign: 'center' }}>Questions you probably have</h2>
          </div>
          <div className="faq-list reveal">
            {faqs.map(([q, a], i) => (
              <div key={i} className={`faq-item${openFaq === i ? ' open' : ''}`}>
                <button className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {q} <div className="faq-icon">+</div>
                </button>
                <div className="faq-a">{a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="final-cta">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="section-label label-violet" style={{ margin: '0 auto 24px', display: 'inline-block' }}>✦ Free to start. No credit card.</div>
          <h2 className="section-headline" style={{ fontSize: '56px' }}>Stop guessing.<br />Start growing.</h2>
          <p className="section-sub" style={{ maxWidth: '480px' }}>Join 2,400+ businesses who let Zofi handle their Meta, Google, and TikTok ads. Most customers see ROAS improvement in their first week.</p>
          <button className="btn-primary" style={{ margin: '4px auto 0', display: 'inline-flex', padding: '16px 36px', fontSize: '17px', borderRadius: '12px' }}>Chat With Zofi — It&apos;s Free →</button>
          <div className="trust-row">
            <div className="trust-item">🔒 Bank-level security</div>
            <div className="trust-item">↩️ Cancel anytime</div>
            <div className="trust-item">⚡ Set up in 10 minutes</div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="logo">Zofi</div>
            <p>Your AI media buyer, always on. Managing Meta, Google &amp; TikTok ads so you don&apos;t have to.</p>
          </div>
          {[
            { h: 'Product', links: ['Features', 'How It Works', 'Pricing', 'Changelog'] },
            { h: 'Platforms', links: ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Analytics'] },
            { h: 'Company', links: ['About', 'Blog', 'Contact', 'Privacy Policy', 'Terms of Service'] },
          ].map(({ h, links }) => (
            <div key={h} className="footer-col">
              <h4>{h}</h4>
              {links.map(l => <a key={l} href="#">{l}</a>)}
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <p>© 2026 Zofi. All rights reserved.</p>
          <p>Built for advertisers worldwide 🌍</p>
        </div>
      </footer>

      <style>
        {
          `
          :root {
  --violet: #6C47FF;
  --violet-dark: #4F2FE8;
  --violet-light: #EDE9FF;
  --navy: #1A1A2E;
  --navy2: #0F0F1A;
  --mint: #00C9A7;
  --mint-light: #E0FAF5;
  --coral: #FF6B6B;
  --coral-light: #FFF0F0;
  --white: #FFFFFF;
  --off: #F8F7FF;
  --gray100: #F3F4F6;
  --gray200: #E5E7EB;
  --gray400: #9CA3AF;
  --gray600: #4B5563;
  --gray800: #1F2937;
}



h1,h2,h3,h4 { font-family: 'Plus Jakarta Sans', sans-serif; }

@keyframes meshMove {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes float {
  0%,100% { transform: translateY(0px); }
  50%      { transform: translateY(-12px); }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@keyframes pulse-dot {
  0%,100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.5); opacity: 0.6; }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes glow {
  0%,100% { box-shadow: 0 0 20px rgba(108,71,255,0.3); }
  50%      { box-shadow: 0 0 40px rgba(108,71,255,0.6); }
}

.reveal {
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.2s; }
.reveal-delay-3 { transition-delay: 0.3s; }
.reveal-delay-4 { transition-delay: 0.4s; }

nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  padding: 18px 48px;
  display: flex; align-items: center; justify-content: space-between;
  transition: all 0.3s ease;
}
nav.scrolled {
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--gray200);
  padding: 14px 48px;
  box-shadow: 0 1px 24px rgba(0,0,0,0.06);
}
.nav-logo {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 24px; font-weight: 800;
  color: var(--violet);
  display: flex; align-items: center; gap: 8px;
  letter-spacing: -0.5px;
}
.nav-logo .z-icon {
  width: 32px; height: 32px;
  background: var(--violet);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 16px; font-weight: 800;
}
.nav-links { display: flex; gap: 32px; list-style: none; }
.nav-links a {
  color: rgba(255,255,255,0.75);
  text-decoration: none; font-size: 14px; font-weight: 500;
  transition: color 0.2s;
}
nav.scrolled .nav-links a { color: var(--gray600); }
.nav-links a:hover { color: white; }
nav.scrolled .nav-links a:hover { color: var(--violet); }
.nav-right { display: flex; align-items: center; gap: 12px; }
.nav-login {
  color: rgba(255,255,255,0.7); text-decoration: none;
  font-size: 14px; font-weight: 500; transition: color 0.2s;
}
nav.scrolled .nav-login { color: var(--gray600); }
.btn-nav {
  background: var(--violet); color: white;
  border: none; padding: 9px 20px; border-radius: 8px;
  font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-nav:hover { background: var(--violet-dark); transform: translateY(-1px); }

.hero {
  min-height: 100vh;
  background: var(--navy);
  background-size: 400% 400%;
  animation: meshMove 12s ease infinite;
  position: relative;
  overflow: hidden;
  display: flex; align-items: center;
  padding: 120px 48px 80px;
}
.hero::before {
  content: '';
  position: absolute; top: -20%; left: -10%;
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(108,71,255,0.25) 0%, transparent 70%);
  border-radius: 50%;
  animation: float 8s ease-in-out infinite;
  pointer-events: none;
}
.hero::after {
  content: '';
  position: absolute; bottom: -20%; right: -5%;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(0,201,167,0.18) 0%, transparent 70%);
  border-radius: 50%;
  animation: float 10s ease-in-out infinite reverse;
  pointer-events: none;
}
.hero-blob2 {
  position: absolute; top: 30%; right: 15%;
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(255,107,107,0.12) 0%, transparent 70%);
  border-radius: 50%;
  animation: float 14s ease-in-out infinite;
  pointer-events: none;
}
.hero-inner {
  max-width: 1200px; margin: 0 auto; width: 100%;
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 80px; align-items: center;
  position: relative; z-index: 1;
}
.hero-badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(108,71,255,0.2);
  border: 1px solid rgba(108,71,255,0.4);
  padding: 6px 14px; border-radius: 100px;
  font-size: 12px; font-weight: 600;
  color: #a78bfa;
  margin-bottom: 24px;
  animation: fadeUp 0.6s ease both;
  letter-spacing: 0.3px;
}
.badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--mint);
  animation: pulse-dot 2s ease infinite;
}
.hero-headline {
  font-size: 58px; font-weight: 800;
  color: white; line-height: 1.1;
  letter-spacing: -2px;
  margin-bottom: 24px;
  animation: fadeUp 0.6s ease 0.1s both;
}
.hero-headline .accent { color: var(--violet); position: relative; }
.hero-headline .accent::after {
  content: '';
  position: absolute; bottom: 2px; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--violet), var(--mint));
  border-radius: 2px;
}
.hero-sub {
  font-size: 17px; line-height: 1.7;
  color: rgba(255,255,255,0.65);
  margin-bottom: 36px;
  animation: fadeUp 0.6s ease 0.2s both;
  max-width: 480px;
}
.hero-btns {
  display: flex; gap: 12px; align-items: center;
  animation: fadeUp 0.6s ease 0.3s both;
  margin-bottom: 36px;
}
.btn-primary {
  background: var(--violet); color: white;
  border: none; padding: 14px 28px; border-radius: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 700;
  cursor: pointer; transition: all 0.2s;
  display: flex; align-items: center; gap: 8px;
  animation: glow 3s ease infinite;
}
.btn-primary:hover { background: var(--violet-dark); transform: translateY(-2px); }
.btn-secondary {
  background: transparent; color: white;
  border: 1.5px solid rgba(255,255,255,0.3);
  padding: 13px 24px; border-radius: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
  display: flex; align-items: center; gap: 8px;
}
.btn-secondary:hover { border-color: white; background: rgba(255,255,255,0.05); }
.hero-proof { display: flex; align-items: center; gap: 12px; animation: fadeUp 0.6s ease 0.4s both; }
.proof-avatars { display: flex; }
.proof-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid var(--navy);
  margin-left: -8px;
  font-size: 11px; font-weight: 700; color: white;
  display: flex; align-items: center; justify-content: center;
}
.proof-avatar:first-child { margin-left: 0; }
.proof-text { font-size: 13px; color: rgba(255,255,255,0.6); }
.proof-text strong { color: white; }
.proof-stars { color: #FBBF24; font-size: 13px; }

.dashboard-wrap { animation: fadeUp 0.8s ease 0.3s both, float 6s ease-in-out 1s infinite; }
.dashboard {
  background: var(--navy2);
  border: 1px solid rgba(108,71,255,0.3);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(108,71,255,0.1);
}
.dash-bar {
  background: #1a1a2e;
  padding: 12px 16px;
  display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.dot-r { width:10px; height:10px; border-radius:50%; background:#FF5F56; }
.dot-y { width:10px; height:10px; border-radius:50%; background:#FFBD2E; }
.dot-g { width:10px; height:10px; border-radius:50%; background:#27C93F; }
.dash-title { margin-left: 8px; font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; }
.dash-metrics {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: rgba(255,255,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.dash-metric { background: var(--navy2); padding: 12px 16px; }
.dm-label { font-size: 10px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.8px; }
.dm-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 20px; font-weight: 700; margin-top: 2px; }
.dm-val.up { color: var(--mint); }
.dm-val.white { color: white; }
.dm-change { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 1px; }
.dash-chat { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.chat-msg { display: flex; gap: 8px; align-items: flex-start; opacity: 0; animation: slideIn 0.4s ease forwards; }
.chat-msg.user { flex-direction: row-reverse; }
.chat-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  flex-shrink: 0; display: flex; align-items: center;
  justify-content: center; font-size: 11px; font-weight: 700;
}
.chat-avatar.zofi { background: var(--violet); color: white; }
.chat-avatar.user { background: rgba(255,255,255,0.1); color: white; }
.chat-bubble { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 12px; line-height: 1.5; }
.chat-bubble.zofi {
  background: rgba(108,71,255,0.15);
  border: 1px solid rgba(108,71,255,0.25);
  color: rgba(255,255,255,0.85);
  border-bottom-left-radius: 4px;
}
.chat-bubble.user { background: var(--violet); color: white; border-bottom-right-radius: 4px; }
.chat-bubble .action-done { color: var(--mint); font-size: 11px; margin-top: 6px; display: flex; align-items: center; gap: 4px; }
.typing-indicator {
  display: flex; gap: 4px; align-items: center;
  padding: 10px 14px;
  background: rgba(108,71,255,0.12);
  border: 1px solid rgba(108,71,255,0.2);
  border-radius: 12px; border-bottom-left-radius: 4px;
  width: fit-content;
}
.typing-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.5); animation: pulse-dot 1.2s ease infinite; }
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
.dash-pills { display: flex; gap: 6px; padding: 0 16px 16px; flex-wrap: wrap; }
.dash-pill { padding: 4px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
.dp-mint { background: rgba(0,201,167,0.15); color: var(--mint); border: 1px solid rgba(0,201,167,0.3); }
.dp-coral { background: rgba(255,107,107,0.15); color: var(--coral); border: 1px solid rgba(255,107,107,0.3); }
.dp-violet { background: rgba(108,71,255,0.15); color: #a78bfa; border: 1px solid rgba(108,71,255,0.3); }

.marquee-section { background: white; border-top: 1px solid var(--gray200); border-bottom: 1px solid var(--gray200); padding: 20px 0; overflow: hidden; }
.marquee-inner { display: flex; animation: marquee 20s linear infinite; white-space: nowrap; }
.marquee-item { display: inline-flex; align-items: center; gap: 6px; padding: 0 28px; font-size: 13px; color: var(--gray400); font-weight: 500; flex-shrink: 0; }
.marquee-item .sep { color: var(--gray200); }

section { padding: 100px 48px; }
.section-inner { max-width: 1200px; margin: 0 auto; }
.section-label {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 14px; border-radius: 100px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.5px;
  text-transform: uppercase; margin-bottom: 20px;
}
.label-violet { background: var(--violet-light); color: var(--violet); }
.label-coral { background: var(--coral-light); color: var(--coral); }
.label-mint { background: var(--mint-light); color: #065F46; }
.section-headline { font-size: 44px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.1; color: var(--navy); margin-bottom: 16px; }
.section-sub { font-size: 17px; line-height: 1.7; color: var(--gray600); max-width: 560px; }

.problem { background: var(--off); }
.problem-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 56px; }
.problem-card { background: white; border: 1px solid var(--gray200); border-radius: 16px; padding: 32px; transition: all 0.25s; }
.problem-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.08); }
.problem-icon { font-size: 40px; margin-bottom: 16px; }
.problem-title { font-size: 20px; font-weight: 700; color: var(--navy); margin-bottom: 10px; }
.problem-body { font-size: 15px; line-height: 1.6; color: var(--gray600); }
.problem-strip { margin-top: 48px; background: linear-gradient(135deg, var(--coral), #FF8E8E); border-radius: 16px; padding: 24px 32px; color: white; font-size: 17px; font-weight: 500; text-align: center; }
.problem-strip strong { font-weight: 800; font-size: 20px; }

.platforms { background: white; }
.platform-tabs { display: flex; gap: 8px; margin: 40px 0 32px; }
.ptab { padding: 10px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border: 1.5px solid var(--gray200); color: var(--gray600); background: white; }
.ptab.active { background: var(--violet); color: white; border-color: var(--violet); }
.ptab:hover:not(.active) { border-color: var(--violet); color: var(--violet); }
.platform-panel { display: none; }
.platform-panel.active { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
.platform-features { list-style: none; }
.pf-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--gray100); font-size: 15px; color: var(--gray600); line-height: 1.5; }
.pf-item:last-child { border-bottom: none; }
.pf-check { color: var(--mint); font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.platform-mockup { background: var(--off); border: 1px solid var(--gray200); border-radius: 16px; overflow: hidden; }
.mock-header { background: white; padding: 14px 20px; border-bottom: 1px solid var(--gray200); font-size: 13px; font-weight: 600; color: var(--navy); display: flex; align-items: center; justify-content: space-between; }
.mock-status { font-size: 11px; color: var(--gray400); }
.mock-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: 12px 20px; border-bottom: 1px solid var(--gray100); font-size: 13px; align-items: center; }
.mock-row.head { background: var(--off); font-weight: 600; color: var(--gray400); font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; }
.mock-name { font-weight: 500; color: var(--navy); }
.mock-val { color: var(--gray600); }
.mock-roas-good { color: var(--mint); font-weight: 600; }
.mock-roas-bad { color: var(--coral); font-weight: 600; }
.status-active { background: var(--mint-light); color: #065F46; font-size: 11px; padding: 3px 8px; border-radius: 100px; font-weight: 600; display: inline-block; }
.status-paused { background: #FFF7ED; color: #92400E; font-size: 11px; padding: 3px 8px; border-radius: 100px; font-weight: 600; display: inline-block; }

.kpi-section { background: var(--navy); padding: 100px 48px; position: relative; overflow: hidden; }
.kpi-section::before { content: ''; position: absolute; top: -100px; right: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(108,71,255,0.2) 0%, transparent 70%); border-radius: 50%; pointer-events: none; }
.kpi-section .section-headline { color: white; }
.kpi-section .section-sub { color: rgba(255,255,255,0.55); }
.kpi-metrics { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; margin: 48px 0 40px; }
.kpi-card { background: rgba(255,255,255,0.03); padding: 24px 20px; transition: background 0.2s; }
.kpi-card:hover { background: rgba(108,71,255,0.1); }
.kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.35); margin-bottom: 10px; }
.kpi-num { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 28px; font-weight: 800; color: white; letter-spacing: -1px; }
.kpi-num.mint { color: var(--mint); }
.kpi-num.coral { color: var(--coral); }
.kpi-change { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 4px; }
.kpi-change.good { color: var(--mint); }

.chart-wrap { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; margin-bottom: 40px; }
.chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.chart-title { font-size: 15px; font-weight: 600; color: white; }
.chart-legend { display: flex; gap: 16px; }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: rgba(255,255,255,0.5); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.chart-svg { width: 100%; height: 140px; }
.chart-line-meta { fill: none; stroke: var(--violet); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 600; stroke-dashoffset: 600; transition: stroke-dashoffset 2s ease 0.5s; }
.chart-line-google { fill: none; stroke: var(--mint); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 600; stroke-dashoffset: 600; transition: stroke-dashoffset 2s ease 0.8s; }
.chart-line-tiktok { fill: none; stroke: var(--coral); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 600; stroke-dashoffset: 600; transition: stroke-dashoffset 2s ease 1.1s; }
.chart-svg.animate .chart-line-meta,
.chart-svg.animate .chart-line-google,
.chart-svg.animate .chart-line-tiktok { stroke-dashoffset: 0; }

.kpi-unique { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.kpi-unique-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; transition: all 0.25s; }
.kpi-unique-card:hover { border-color: rgba(108,71,255,0.4); background: rgba(108,71,255,0.08); }
.ku-icon { font-size: 28px; margin-bottom: 12px; }
.ku-title { font-size: 14px; font-weight: 700; color: white; margin-bottom: 8px; }
.ku-body { font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.45); }

.chat-section { background: var(--off); }
.chat-section .section-headline { text-align: center; }
.chat-section .section-sub { text-align: center; margin: 0 auto 56px; }
.chat-showcase { max-width: 900px; margin: 0 auto; background: white; border: 1px solid var(--gray200); border-radius: 20px; overflow: hidden; box-shadow: 0 24px 80px rgba(108,71,255,0.1); }
.cs-header { background: var(--navy); padding: 18px 24px; display: flex; align-items: center; gap: 12px; }
.cs-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--violet); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 16px; }
.cs-info .cs-name { font-size: 15px; font-weight: 700; color: white; }
.cs-info .cs-role { font-size: 12px; color: rgba(255,255,255,0.45); }
.cs-online { display: flex; align-items: center; gap: 5px; margin-left: auto; font-size: 12px; color: var(--mint); }
.cs-online-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mint); animation: pulse-dot 2s infinite; }
.cs-body { padding: 28px; display: flex; flex-direction: column; gap: 16px; max-height: 440px; overflow-y: auto; }
.cs-body::-webkit-scrollbar { width: 4px; }
.cs-body::-webkit-scrollbar-track { background: transparent; }
.cs-body::-webkit-scrollbar-thumb { background: var(--gray200); border-radius: 2px; }
.cs-msg { display: flex; gap: 10px; align-items: flex-start; }
.cs-msg.user { flex-direction: row-reverse; }
.cs-msg-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.cs-msg-avatar.z { background: var(--violet); color: white; }
.cs-msg-avatar.u { background: var(--gray100); color: var(--gray600); }
.cs-bubble { max-width: 72%; padding: 14px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; }
.cs-bubble.z { background: var(--violet-light); color: var(--gray800); border-bottom-left-radius: 4px; border-left: 3px solid var(--violet); }
.cs-bubble.u { background: var(--violet); color: white; border-bottom-right-radius: 4px; }
.cs-action { display: flex; align-items: center; gap: 6px; color: var(--mint); font-size: 13px; font-weight: 600; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(108,71,255,0.15); }
.cs-suggestions { padding: 16px 28px; border-top: 1px solid var(--gray100); display: flex; flex-wrap: wrap; gap: 8px; }
.cs-chip { padding: 7px 14px; border-radius: 100px; border: 1.5px solid var(--gray200); font-size: 13px; color: var(--gray600); cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.cs-chip:hover { border-color: var(--violet); color: var(--violet); background: var(--violet-light); }
.cs-input-row { padding: 16px 28px; border-top: 1px solid var(--gray100); display: flex; gap: 10px; align-items: center; }
.cs-input { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1.5px solid var(--gray200); font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--gray800); outline: none; transition: border-color 0.2s; }
.cs-input:focus { border-color: var(--violet); }
.cs-send { width: 42px; height: 42px; border-radius: 10px; background: var(--violet); border: none; color: white; font-size: 16px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
.cs-send:hover { background: var(--violet-dark); transform: scale(1.05); }

.pricing { background: white; }
.pricing-toggle { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 40px 0; }
.toggle-track { width: 48px; height: 26px; background: var(--violet); border-radius: 100px; cursor: pointer; position: relative; transition: background 0.2s; }
.toggle-thumb { width: 20px; height: 20px; background: white; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: transform 0.25s; }
.toggle-label { font-size: 14px; font-weight: 500; color: var(--gray600); }
.toggle-badge { background: var(--mint-light); color: #065F46; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 100px; }
.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1000px; margin: 0 auto; }
.pricing-card { border: 1.5px solid var(--gray200); border-radius: 20px; padding: 36px 32px; position: relative; transition: all 0.25s; }
.pricing-card:hover { transform: translateY(-4px); box-shadow: 0 20px 50px rgba(0,0,0,0.08); }
.pricing-card.featured { border-color: var(--violet); background: linear-gradient(135deg, rgba(108,71,255,0.03), rgba(108,71,255,0.01)); box-shadow: 0 8px 40px rgba(108,71,255,0.15); transform: scale(1.03); }
.pricing-card.featured:hover { transform: scale(1.03) translateY(-4px); }
.popular-badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--violet); color: white; font-size: 11px; font-weight: 700; padding: 4px 14px; border-radius: 100px; white-space: nowrap; letter-spacing: 0.3px; }
.price-plan { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--gray400); margin-bottom: 12px; }
.price-num { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 48px; font-weight: 800; color: var(--navy); letter-spacing: -2px; margin-bottom: 4px; }
.price-num sup { font-size: 24px; letter-spacing: 0; vertical-align: top; margin-top: 8px; display: inline-block; }
.price-num span { font-size: 16px; letter-spacing: 0; color: var(--gray400); font-weight: 400; }
.price-desc { font-size: 14px; color: var(--gray600); margin-bottom: 28px; line-height: 1.5; }
.price-btn { width: 100%; padding: 13px; border-radius: 10px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-bottom: 28px; }
.price-btn-outline { background: white; color: var(--violet); border: 1.5px solid var(--violet); }
.price-btn-outline:hover { background: var(--violet-light); }
.price-btn-filled { background: var(--violet); color: white; border: none; }
.price-btn-filled:hover { background: var(--violet-dark); transform: translateY(-1px); }
.price-btn-dark { background: var(--navy); color: white; border: none; }
.price-btn-dark:hover { background: #2a2a40; }
.price-features { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.pf { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--gray600); line-height: 1.4; }
.pf-icon-ok { color: var(--mint); font-size: 14px; flex-shrink: 0; }
.pf-icon-no { color: var(--gray300); font-size: 14px; flex-shrink: 0; opacity: 0.3; }

.faq { background: var(--off); }
.faq-list { max-width: 760px; margin: 56px auto 0; }
.faq-item { border-bottom: 1px solid var(--gray200); overflow: hidden; }
.faq-q { width: 100%; background: none; border: none; text-align: left; padding: 20px 0; display: flex; align-items: center; justify-content: space-between; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 17px; font-weight: 600; color: var(--navy); cursor: pointer; gap: 16px; }
.faq-icon { width: 28px; height: 28px; border-radius: 50%; background: var(--gray100); color: var(--gray600); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; transition: all 0.25s; }
.faq-item.open .faq-icon { background: var(--violet-light); color: var(--violet); transform: rotate(45deg); }
.faq-a { font-size: 15px; line-height: 1.7; color: var(--gray600); max-height: 0; overflow: hidden; transition: max-height 0.35s ease, padding 0.35s ease; }
.faq-item.open .faq-a { max-height: 200px; padding-bottom: 20px; }

.final-cta { background: var(--navy); padding: 120px 48px; text-align: center; position: relative; overflow: hidden; }
.final-cta::before { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 600px; height: 400px; background: radial-gradient(ellipse, rgba(108,71,255,0.25) 0%, transparent 70%); pointer-events: none; }
.final-cta .section-headline { color: white; text-align: center; font-size: 56px; margin-bottom: 16px; }
.final-cta .section-sub { color: rgba(255,255,255,0.55); text-align: center; margin: 0 auto 40px; }
.trust-row { display: flex; align-items: center; justify-content: center; gap: 28px; margin-top: 28px; }
.trust-item { display: flex; align-items: center; gap: 7px; font-size: 14px; color: rgba(255,255,255,0.45); }

footer { background: #0a0a12; padding: 60px 48px 32px; }
.footer-grid { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 48px; }
.footer-brand .logo { font-family: 'Plus Jakarta Sans'; font-size: 22px; font-weight: 800; color: var(--violet); margin-bottom: 10px; }
.footer-brand p { font-size: 13px; color: rgba(255,255,255,0.35); line-height: 1.6; max-width: 220px; }
.footer-col h4 { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
.footer-col a { display: block; font-size: 14px; color: rgba(255,255,255,0.35); text-decoration: none; margin-bottom: 10px; transition: color 0.2s; }
.footer-col a:hover { color: white; }
.footer-bottom { max-width: 1200px; margin: 0 auto; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 24px; display: flex; align-items: center; justify-content: space-between; }
.footer-bottom p { font-size: 13px; color: rgba(255,255,255,0.25); }

          `
        }
      </style>
    </>
  )
}