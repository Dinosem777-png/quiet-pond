<?php
declare(strict_types=1);
// Copy to config.php on the server only. Never commit secrets.
const BOT_TOKEN = 'ADD_TELEGRAM_BOT_TOKEN';
const TELEGRAM_WEBHOOK_SECRET = 'CHANGE_TO_A_LONG_RANDOM_SECRET';
const OPENAI_API_KEY = 'ADD_AI_API_KEY';
const OPENAI_MODEL = 'gpt-4.1-mini';
const DB_HOST = 'localhost';
const DB_NAME = 'database_name';
const DB_USER = 'database_user';
const DB_PASS = 'database_password';
function db(): PDO {
 static $pdo=null;
 if($pdo instanceof PDO)return $pdo;
 $pdo=new PDO('mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4',DB_USER,DB_PASS,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 return $pdo;
}
function generate_reading(string $kind,string $prompt,string $sign): string {
 if(OPENAI_API_KEY==='ADD_AI_API_KEY')return 'Демо-режим: администратор ещё не подключил ИИ.';
 $types=['daily'=>'Карта дня: выбери одну символическую карту Таро и объясни её послание, совет и тему дня.','tarot_love'=>'Любовное Таро: бережно разбери чувства, динамику отношений и полезный совет.','tarot_future'=>'Расклад из трёх карт: прошлое, настоящее, возможное направление будущего.','horoscope'=>'Составь персональный развлекательный гороскоп на ближайшее время.','compatibility'=>'Символический разбор совместимости, сильных сторон и зон роста пары.','dream'=>'Разбери символы сна и возможные психологические ассоциации, без категоричных трактовок.','numerology'=>'Сделай нумерологическую интерпретацию по данным запроса; если даты нет, попроси её уточнить.','question'=>'Ответь как бережный символический ИИ-оракул на конкретный вопрос.'];
 $task=$types[$kind]??$types['question'];
 $system='Ты — Оракул, русскоязычный AI-помощник по символическим практикам Таро, астрологии и нумерологии. Давай содержательные, тёплые и структурированные ответы. Не выдавай интерпретации за факты или гарантированное предсказание. Не давай медицинских, юридических, финансовых указаний и не подталкивай к опасным решениям. Если данных недостаточно, честно обозначь это.';
 $payload=['model'=>OPENAI_MODEL,'messages'=>[['role'=>'system','content'=>$system],['role'=>'user','content'=>$task."\nЗнак зодиака: ".$sign."\nЗапрос пользователя: ".$prompt."\nОтветь на русском, с кратким итогом и практичным бережным советом."]],'temperature'=>0.8];
 $ch=curl_init('https://api.openai.com/v1/chat/completions');
 curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_UNESCAPED_UNICODE),CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.OPENAI_API_KEY],CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>45]);
 $raw=curl_exec($ch); if($raw===false){curl_close($ch);throw new RuntimeException('Сервис ИИ временно недоступен');}
 $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch); $r=json_decode($raw,true);
 if($status>=400)throw new RuntimeException('Ошибка сервиса ИИ');
 $answer=$r['choices'][0]['message']['content']??''; if(!is_string($answer)||$answer==='')throw new RuntimeException('Пустой ответ ИИ');
 return $answer;
}
