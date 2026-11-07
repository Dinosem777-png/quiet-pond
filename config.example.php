<?php
declare(strict_types=1);
// Copy to config.php on hosting. Never upload config.php to GitHub.
const BOT_TOKEN = 'ADD_TELEGRAM_BOT_TOKEN';
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
 $system='Ты бережный и творческий AI-оракул. Создавай символические развлекательные интерпретации на русском языке. Не утверждай, что знаешь будущее наверняка. Не давай медицинских, юридических или финансовых гарантий.';
 $payload=['model'=>OPENAI_MODEL,'messages'=>[['role'=>'system','content'=>$system],['role'=>'user','content'=>'Тип расклада: '.$kind.'. Знак: '.$sign.'. Запрос: '.$prompt]],'temperature'=>0.85];
 $ch=curl_init('https://api.openai.com/v1/chat/completions');
 curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload),CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.OPENAI_API_KEY],CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>45]);
 $raw=curl_exec($ch); if($raw===false)throw new RuntimeException('Сервис ИИ временно недоступен'); curl_close($ch);
 $r=json_decode($raw,true); return $r['choices'][0]['message']['content']??'Не удалось получить ответ ИИ.';
}
