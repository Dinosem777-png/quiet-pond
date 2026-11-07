<?php
declare(strict_types=1);
require_once __DIR__.'/../config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function out(int $code,array $data): never { http_response_code($code); echo json_encode($data,JSON_UNESCAPED_UNICODE); exit; }
function verify_init(string $data): array {
 parse_str($data,$a); $hash=$a['hash']??''; if(!$hash) throw new RuntimeException('Откройте приложение через Telegram');
 unset($a['hash']); ksort($a);
 $check=implode("\n",array_map(fn($k)=>$k.'='.$a[$k],array_keys($a)));
 $secret=hash_hmac('sha256',BOT_TOKEN,'WebAppData',true);
 if(!hash_equals(hash_hmac('sha256',$check,$secret),$hash)) throw new RuntimeException('Неверная подпись Telegram');
 if(time()-(int)($a['auth_date']??0)>86400) throw new RuntimeException('Сессия Telegram устарела');
 $u=json_decode($a['user']??'{}',true); if(empty($u['id'])) throw new RuntimeException('Пользователь не найден'); return $u;
}
try {
 if($_SERVER['REQUEST_METHOD']!=='POST') out(405,['error'=>'Method not allowed']);
 $in=json_decode(file_get_contents('php://input'),true)??[];
 $u=verify_init((string)($in['initData']??''));
 $q=db()->prepare("SELECT id,kind,prompt,sign,stars,status,result,created_at,paid_at FROM orders WHERE telegram_id=? AND status IN ('fulfilled','paid') ORDER BY id DESC LIMIT 30");
 $q->execute([(string)$u['id']]);
 out(200,['items'=>$q->fetchAll()]);
} catch(Throwable $e) { error_log($e->getMessage()); out(400,['error'=>'Не удалось загрузить историю']); }
