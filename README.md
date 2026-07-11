# DIY Business Control v1

גרסת Web/PWA ראשונה, מותאמת לטלפון ולטאבלט.

## מה יש בפנים
- כניסה והרשמה דרך Supabase
- פתיחת עסק
- מסך בית עם תמונת מצב
- ניווט: בית, הוצאות, פיננסים, צוות, AL
- כפתור + לפעולות יומיומיות
- הוספת הוצאה ושמירתה ב-Supabase
- העלאת תמונות או PDF
- חילוץ נתוני חשבונית עם OpenAI
- דו"ח Z
- רשימת הוצאות
- רשימת דו"חות Z
- רשימת עובדות
- תובנות AL בסיסיות
- PWA שניתן להוסיף למסך הבית

## העלאה מהטלפון ל-GitHub
1. פתחי את ה-Repository.
2. לחצי Add file.
3. בחרי Upload files.
4. העלי את כל תוכן התיקייה, לא את קובץ ה-ZIP עצמו.
5. Commit changes.

## Render
משתני סביבה נדרשים:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- OPENAI_API_KEY
- OPENAI_MODEL = gpt-4.1-mini

Render יקרא את render.yaml ויעלה את האפליקציה.
