# Оракул — Telegram Mini App

Мобильное Telegram Web App для символических раскладов Таро, гороскопов, совместимости, толкования снов и нумерологии с генерацией ответов через OpenAI.

## Возможности в коде
- Мобильный интерфейс и Telegram Web Apps SDK.
- Каталог услуг с ценами в Telegram Stars (XTR).
- Бесплатная карта дня — не чаще одного раза в сутки на пользователя.
- Проверка подписи Telegram initData и срока сессии.
- Создание Stars invoice link.
- Webhook для pre_checkout_query и successful_payment с проверкой секрета, валюты и суммы.
- Хранение заказов и история завершённых раскладов.
- Секреты исключены из Git через .gitignore.

## Требования к серверу
PHP 8.1+, HTTPS, MySQL/MariaDB, расширения cURL, PDO MySQL и mbstring.

## Установка
1. Загрузить содержимое репозитория в корень сайта (обычно htdocs). На сайте должен открываться index.html.
2. На сервере скопировать config.example.php в config.php. Заполнить BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (длинная случайная строка), OPENAI_API_KEY и параметры MySQL. Не коммитить config.php.
3. Импортировать database/schema.sql в выбранную базу данных. Если таблица orders уже существует, повторный импорт создаст новую таблицу daily_free_uses; существующая таблица заказов сохранится.
4. В BotFather задать URL Mini App с HTTPS-адресом сайта.
5. Установить webhook на https://ВАШ-ДОМЕН/api/webhook.php, передав тот же секрет, что указан в TELEGRAM_WEBHOOK_SECRET, в параметре Telegram secret_token.
6. Проверить запуск через Telegram, затем тестировать Stars и историю.

## Важно
- Пока не заполнен config.php, приложение не подключится к Telegram и OpenAI.
- Не публикуйте BOT_TOKEN, OPENAI_API_KEY, пароль базы данных или webhook secret.
- Не принимайте реальные платежи до установки HTTPS, импорта схемы и проверки webhook на тестовом заказе.
- Предсказания носят развлекательный характер и не являются гарантией будущего.
