<?php
declare(strict_types=1);
require_once __DIR__.'/../config.php';
$provided=$_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN']??'';
if(TELEGRAM_WEBHOOK_SECRET==='CHANGE_TO_A_LONG_RANDOM_SECRET'||!hash_equals(TELEGRAM_WEBHOOK_SECRET,$provided)){http_response_code(403);exit('Forbidden');}
function tg(string $method,array $data): array {
 $ch=curl_init('https://api.telegram.org/bot'.BOT_TOKEN.'/'.$method);
 curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($data,JSON_UNESCAPED_UNICODE),CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>35]);
 $raw=curl_exec($ch);if($raw===false){curl_close($ch);throw new RuntimeException('Telegram API error');}
 curl_close($ch);$r=json_decode($raw,true)??[];if(empty($r['ok']))throw new RuntimeException($r['description']??'Telegram API error');return $r;
}
$update=json_decode(file_get_contents('php://input'),true)??[];
try {
 if(isset($update['pre_checkout_query'])) {
  $q=$update['pre_checkout_query'];$pdo=db();$s=$pdo->prepare("SELECT id,stars,status FROM orders WHERE payload=? LIMIT 1");$s->execute([$q['invoice_payload']]);$o=$s->fetch();
  $ok=$o && $o['status']==='pending' && (int)$o['stars']===(int)($q['total_amount']??0) && ($q['currency']??'')==='XTR';
  tg('answerPreCheckoutQuery',['pre_checkout_query_id'=>$q['id'],'ok'=>(bool)$ok]+($ok?[]:['error_message'=>'Заказ не найден или сумма не совпадает. Обратитесь в поддержку.']));
 }
 if(isset($update['message']['successful_payment'])) {
  $m=$update['message'];$p=$m['successful_payment'];$pdo=db();
  $pdo->beginTransaction();$s=$pdo->prepare("SELECT * FROM orders WHERE payload=? FOR UPDATE");$s->execute([$p['invoice_payload']]);$o=$s->fetch();
  if($o && $o['status']==='pending' && (int)$o['stars']===(int)$p['total_amount'] && ($p['currency']??'')==='XTR') {
   $result=generate_reading($o['kind'],$o['prompt'],$o['sign']);
   $u=$pdo->prepare("UPDATE orders SET status='fulfilled',telegram_charge_id=?,result=?,paid_at=NOW() WHERE id=? AND status='pending'");
   $u->execute([$p['telegram_payment_charge_id'],$result,$o['id']]);$pdo->commit();
   tg('sendMessage',['chat_id'=>$m['chat']['id'],'text'=>"✨ Ваше предсказание готово!\n\n".$result]);
  } else {$pdo->rollBack();}
 }
 http_response_code(200);echo 'OK';
} catch(Throwable $e) {if(isset($pdo)&&$pdo instanceof PDO&&$pdo->inTransaction())$pdo->rollBack();error_log($e->getMessage());http_response_code(500);echo 'Temporary error';}
