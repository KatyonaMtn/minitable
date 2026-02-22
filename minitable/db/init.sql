CREATE TABLE IF NOT EXISTS creative_tasks (
    id SERIAL PRIMARY KEY,
    tasks_name TEXT,
    compose TEXT,
    link_to_ad TEXT,
    stage TEXT,
    task_owner TEXT,
    deadline TEXT,
    team TEXT,
    ai_services TEXT,
    purchases INTEGER DEFAULT 0,
    platform TEXT,
    product TEXT,
    localization TEXT,
    size TEXT,
    concept TEXT,
    status TEXT,
    compose_creator TEXT,
    compose_done_date TEXT,
    attachments TEXT,
    impressions INTEGER DEFAULT 0,
    test_status TEXT
);

-- Наполняем базу 50,000 случайными записями
INSERT INTO creative_tasks (
    tasks_name, compose, link_to_ad, stage, task_owner,
    deadline, team, ai_services, platform, product,
    localization, size, concept, status, compose_creator,
    compose_done_date, attachments, purchases, impressions, test_status
)
SELECT
    'Task ' || i || '_ai_avatars_' || (ARRAY['grass', 'water', 'fire'])[floor(random() * 3 + 1)],
    'Hook: Sample script for task ' || i || '. This is a creative compose describing the ad content.',
    'https://dropbox.com/sh/' || md5(random()::text),
    (ARRAY['Compositing', 'Production', 'Review', 'Done'])[floor(random() * 4 + 1)],
    (ARRAY['Vadym Mytnytskyi', 'Ivan Ivanov', 'Anna Smith', 'Kate Brown', 'John Doe'])[floor(random() * 5 + 1)],
    TO_CHAR(NOW() + (floor(random() * 60) || ' days')::INTERVAL, 'DD/MM/YYYY'),
    (ARRAY['Internal', 'External', 'Growth', 'Brand'])[floor(random() * 4 + 1)],
    (ARRAY['Nano Banana', 'Oliveia', 'MidJourney', 'ElevenLabs', 'Runway'])[floor(random() * 5 + 1)],
    (ARRAY['Facebook', 'TikTok', 'Google', 'YouTube', 'Instagram'])[floor(random() * 5 + 1)],
    (ARRAY['Visify', 'NovaMind', 'FlowAI', 'PixelPro'])[floor(random() * 4 + 1)],
    (ARRAY['English (_en_)', 'Spanish (_es_)', 'German (_de_)', 'French (_fr_)', 'Portuguese (_pt_)'])[floor(random() * 5 + 1)],
    (ARRAY['9x16', '16x9', '1x1', '4x5', '2x3'])[floor(random() * 5 + 1)],
    (ARRAY['New Concept', 'Testimonial', 'Demo', 'Tutorial', 'UGC'])[floor(random() * 5 + 1)],
    (ARRAY['Done', 'In Progress', 'Planned', 'In Approve', 'Rejected'])[floor(random() * 5 + 1)],
    (ARRAY['Masalitin Ivan', 'Oksana Koval', 'Dmytro Petrenko', 'Sofia Marchuk'])[floor(random() * 4 + 1)],
    TO_CHAR(NOW() - (floor(random() * 30) || ' days')::INTERVAL, 'DD/MM/YYYY'),
    CASE WHEN random() > 0.7 THEN 'https://dropbox.com/sh/' || md5(random()::text) ELSE NULL END,
    floor(random() * 50000)::INTEGER,
    floor(random() * 1000000)::INTEGER,
    (ARRAY['Pass', 'Fail', 'Pending', 'Skip'])[floor(random() * 4 + 1)]
FROM generate_series(1, 50000) s(i);
