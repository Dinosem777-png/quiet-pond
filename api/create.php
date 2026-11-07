<?php
declare(strict_types=1);
require_once __DIR__.'/../config.php';
header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
function answer(int $code,array $data): never {http_response_code($code);echo json_encode($data,JSON_UNESCAPED_UNICODE);exit;}
function telegram(string $method,array $data): array {
 $ch=curl_init('https://api.telegram.org/bot'.BOT_TOKEN.'/'.$method);
 curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($data),CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>25]);
 $raw=curl_exec($ch);if($raw===false)throw new RuntimeException('Telegram API недоступен');curl_close($ch);$r=json_decode($raw,true);
 if(empty($r['ok']))throw new RuntimeException($r['description']??'Ошибка Telegram API');return $r;
}
function verify_init(string $data): array {
 parse_str($data,$a);$hash=$a['hash']??'';if(!$hash)throw new RuntimeException('Откройте приложение через Telegram');
 unset($a['hash']);ksort($a);$check=implode("\n",array_map(fn($k)=>$k.'='.$a[$k],array_keys($a)));
 $secret=hash_hmac('sha256',BOT_TOKEN,'WebAppData',true);$calc=hash_hmac('sha256',$check,$secret);
 if(!hash_equals($calc,$hash))throw new RuntimeException('Не удалось подтвердить профиль Telegram');
 if(time()-(int)($a['auth_date']??0)>86400)throw new RuntimeException('Сессия Telegram устарела');
 $user=json_decode($a['user']??'{}',true);if(empty($user['id']))throw new RuntimeException('Пользователь Telegram не найден');return $user;
}
if($_SERVER['REQUEST_METHOD']!=='POST')answer(405,['error'=>'Method not allowed']);
try {
 if(BOT_TOKEN==='ADD_TELEGRAM_BOT_TOKEN')answer(503,['error'=>'Бот ещё не настроен']);
 $in=json_decode(file_get_contents('php://input'),true);if(!is_array($in))answer(400,['error'=>'Некорректный запрос']);
 $prices=['daily'=>0,'tarot_love'=>25,'tarot_future'=>35,'horoscope'=>20,'compatibility'=>30,'dream'=>15,'numerology'=>25,'question'=>50];
 $kind=(string)($in['kind']??'');if(!isset($prices[$kind]))answer(400,['error'=>'Неизвестная услуга']);
 $prompt=trim((string)($in['prompt']??''));$sign=trim((string)($in['sign']??''));if(mb_strlen($prompt)>700)answer(400,['error'=>'Слишком длинный запрос']);
 $user=verify_init((string)($in['initData']??''));$price=$prices[$kind];
 if($price===0)answer(200,['result'=>generate_reading($kind,$prompt,$sign)]);
 $payload=bin2hex(random_bytes(16));$pdo=db();
 $q=$pdo->prepare('INSERT INTO orders (telegram_id,payload,kind,prompt,sign,stars,status,created_at) VALUES (?,?,?,?,?,?,?,NOW())');
 $q->execute([(string)$user['id'],$payload,$kind,$prompt,$sign,$price,'pending']);
 $names=['tarot_love'=>'Любовное Таро','tarot_future'=>'Расклад на три карты','horoscope'=>'Гороскоп','compatibility'=>'Совместимость','dream'=>'Толкование сна','numerology'=>'Нумерология','question'=>'Вопрос Оракулу'];
 $name=$names[$kind]??'Предсказание';
 $invoice=telegram('createInvoiceLink',['title'=>$name,'description'=>'Персональный ответ ИИ в приложении Оракул','payload'=>$payload,'provider_token'=>'','currency'=>'XTR','prices'=>[['label'=>$name,'amount'=>$price]]]);
 answer(200,['invoiceLink'=>$invoice['result']]);
} catch(Throwable $e) {error_log($e->getMessage());answer(400,['error'=>$e->getMessage()]);}
