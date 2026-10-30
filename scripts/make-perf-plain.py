# 纯文本视图性能用的虚构文本（beta.7）：3000 段，约每 15 段改一处。python3 scripts/make-perf-plain.py <输出目录> [段数]
import random, sys, os
random.seed(7)
out = sys.argv[1]; n = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
words = '甲方 乙方 服务 期限 费用 保密 违约 责任 通知 争议 解决 适用 法律 附件 生效 终止 数据 安全 交付 验收 支付 发票 税费 知识产权 许可'.split()
def sent(k): return '，'.join(''.join(random.choice(words) for _ in range(random.randint(3, 6))) for _ in range(k)) + '。'
A, B = [], []
for i in range(1, n + 1):
    a = f'{i}. ' + sent(random.randint(2, 5))
    b = a
    if i % 15 == 0: b = a.replace('，', '，并且', 1)
    if i % 97 == 0: b = f'{i}. ' + sent(3)
    if i % 211 != 0: A.append(a)
    if i % 223 != 0: B.append(b)
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'plain-A.txt'), 'w').write('\n'.join(A) + '\n')
open(os.path.join(out, 'plain-B.txt'), 'w').write('\n'.join(B) + '\n')
