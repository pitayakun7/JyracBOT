const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ActivityType, MessageFlags 
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

// --- 1. Firebaseの初期化 (環境変数 FIREBASE_SERVICE_ACCOUNT を使用) ---
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim());
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        console.log("✅ Firebase initialized successfully!");
    } catch (e) {
        console.error("❌ Firebase initialization failed:", e);
    }
}
const db = admin.firestore();

// --- 2. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// チケットパネルのメッセージ内容を保持する一時メモリ
const ticketMessages = new Map();

// アクティビティ（ステータス）の設定
const activities = [
    "JYRAC公式Instはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお問い合わせはDisID’pitayakun7’まで",
    "広告募集中1",
    "広告募集中2",
];
const intervalSeconds = 15;

// --- 3. 全スラッシュコマンドの定義 ---
const commands = [
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder()
        .setName('role-confirmation')
        .setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder()
        .setName('delete')
        .setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('コマンドの詳細パネルを表示します')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder()
        .setName('give-role')
        .setDescription('指定したメンバーにロールを付与します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder()
        .setName('remove-role')
        .setDescription('指定したメンバーからロールを剥奪します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('剥奪するロール').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

    new SlashCommandBuilder()
        .setName('admin-add')
        .setDescription('ボット管理者にユーザーを追加します')
        .addUserOption(o => o.setName('target').setDescription('追加するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('admin-remove')
        .setDescription('ボット管理者からユーザーを削除します')
        .addUserOption(o => o.setName('target').setDescription('削除するユーザー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
].map(c => {
    const json = c.toJSON();
    // ユーザーインストールコマンド設定
    json.integration_types = [0, 1]; 
    json.contexts = [0, 1, 2];        
    return json;
});

// --- 4. 起動時処理とコマンド登録 ---
client.once('ready', async () => {
    console.log(`${client.user.tag} としてログインしました！`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Discord APIへのコマンド登録（グローバル）に成功しました！');
    } catch (error) {
        console.error('❌ コマンド登録中にエラーが発生しました:', error);
    }

    // ステータスを定期更新
    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

// Render等のプラットフォーム用Webサーバー
const app = express();
app.get('/', (req, res) => res.send('Bot is Running!'));
app.listen(3000);

// --- 5. インタラクション（コマンド・ボタン・メニュー）の処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    // スラッシュコマンドの処理
    if (interaction.isChatInputCommand()) {
        // 【重要】3秒ルール回避のため、まず即座に保留する
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            return console.error("Defer Error:", e);
        }

        // --- 権限判定ロジック ---
        if (interaction.guild) {
            try {
                const adminDoc = await db.collection('bot_admins').doc(interaction.user.id).get();
                const isBotAdmin = adminDoc.exists;
                const isOwner = interaction.user.id === interaction.guild.ownerId;
                const hasHigherRole = interaction.member.roles.highest.position > interaction.guild.members.me.roles.highest.position;

                // 管理者でもオーナーでもなく、ロール順位もBotより下なら拒否
                if (!isBotAdmin && !isOwner && !hasHigherRole) {
                    return await interaction.editReply("❌ このコマンドを実行する権限がありません（ボット管理者ではない、またはロール順位が不足しています）。");
                }
            } catch (err) {
                console.error("Auth Check Error:", err);
            }
        }

        const { commandName, options } = interaction;

        // admin-add: Firebaseに管理者を追加
        if (commandName === 'admin-add') {
            const target = options.getUser('target');
            try {
                await db.collection('bot_admins').doc(target.id).set({
                    username: target.tag,
                    userId: target.id,
                    addedAt: new Date()
                });
                return await interaction.editReply(`✅ **${target.tag}** をボット管理者に登録しました。`);
            } catch (error) {
                return await interaction.editReply("❌ データベース登録中にエラーが発生しました。");
            }
        }

        // admin-remove: Firebaseから管理者を削除
        if (commandName === 'admin-remove') {
            const target = options.getUser('target');
            try {
                await db.collection('bot_admins').doc(target.id).delete();
                return await interaction.editReply(`🗑️ **${target.tag}** をボット管理者から解除しました。`);
            } catch (error) {
                return await interaction.editReply("❌ データベース削除中にエラーが発生しました。");
            }
        }

        // help: コマンド説明
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 ボットコマンドヘルプ')
                .setDescription('詳細を確認したいコマンドを下のメニューから選択してください。')
                .setColor(0x00AE86)
                .setTimestamp();

            const select = new StringSelectMenuBuilder()
                .setCustomId('help_select')
                .setPlaceholder('コマンドを選択...')
                .addOptions(
                    { label: '/verify', value: 'help_verify', description: '認証パネルについて' },
                    { label: '/ticket', value: 'help_ticket', description: 'チケットシステムについて' },
                    { label: '/role-confirmation', value: 'help_role', description: 'ロール確認について' },
                    { label: '/delete', value: 'help_delete', description: '一括削除について' }
                );
            
            const row = new ActionRowBuilder().addComponents(select);
            return await interaction.editReply({ embeds: [embed], components: [row] });
        }

        // delete: メッセージ一括削除（二段階確認）
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.editReply('1〜100の間で指定してください。');
            
            const messages = await interaction.channel.messages.fetch({ limit: 1 }).catch(() => null);
            const lastMsg = messages?.first();
            let msgPreview = lastMsg ? `**最後の発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "(画像等)"}` : "取得失敗。";
            
            const embed = new EmbedBuilder()
                .setTitle('⚠️ 削除確認')
                .setDescription(`本当に **${amount}件** のメッセージを削除しますか？\n\n${msgPreview}`)
                .setColor(0xFF0000);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_confirm_${amount}`).setLabel('削除実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return await interaction.editReply({ embeds: [embed], components: [row] });
        }

        // verify: 認証パネル設置
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const title = options.getString('title') ?? 'ロール認証';
            const desc = options.getString('description') ?? '下のボタンを押すとロールが付与されます。';
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証').setStyle(ButtonStyle.Success)
            );
            
            // Ephemeralな返信を消し、チャンネルにメッセージを送信
            await interaction.deleteReply().catch(() => {});
            return await interaction.channel.send({ embeds: [embed], components: [row] });
        }

        // ticket: チケットパネル設置
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            const panelDesc = options.getString('panel-desc') ?? '担当者が来るまでお待ちください。';
            ticketMessages.set(messageKey, panelDesc);

            const title = options.getString('title') ?? 'チケット発行';
            const desc = options.getString('description') ?? 'お問い合わせは下のボタンを押してください。';
            
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 発行').setStyle(ButtonStyle.Primary)
            );
            
            await interaction.deleteReply().catch(() => {});
            return await interaction.channel.send({ embeds: [embed], components: [row] });
        }

        // role-confirmation: ロール一覧表示
        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.editReply('メンバー情報の取得に失敗しました。');
            
            const roles = member.roles.cache
                .filter(r => r.name !== '@everyone')
                .sort((a,b) => b.position - a.position)
                .map(r => r.name)
                .join('\n') || 'なし';
            
            return await interaction.editReply(`**${member.user.tag}** の所持ロール一覧:\n\`\`\`\n${roles}\n\`\`\``);
        }

        // give-role / remove-role: ロール付与・剥奪
        if (commandName === 'give-role' || commandName === 'remove-role') {
            const targetMember = options.getMember('target');
            const role = options.getRole('role');
            const isGive = commandName === 'give-role';

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                return await interaction.editReply('❌ Botのロール順位より高いため、そのロールは操作できません。');
            }
            try {
                if (isGive) await targetMember.roles.add(role);
                else await targetMember.roles.remove(role);
                return await interaction.editReply(`✅ ${targetMember.user.tag} のロール操作を完了しました。`);
            } catch (e) {
                return await interaction.editReply('❌ 権限不足により操作に失敗しました。');
            }
        }
    }

    // --- セレクトメニュー処理 (Help) ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_select') {
        const info = {
            help_verify: "【/verify】\n認証ボタン付きのパネルを作成します。押した人に指定のロールを付与します。",
            help_ticket: "【/ticket】\nチケット発行システムです。作成されたチケットは指定の管理者ロールのみ閲覧可能です。",
            help_role: "【/role-confirmation】\n指定したユーザーが現在持っている全ロールをリストアップします。",
            help_delete: "【/delete】\nメッセージを一括削除します。誤削除防止の確認ボタンが表示されます。"
        };
        const embed = new EmbedBuilder()
            .setTitle('📜 コマンド詳細説明')
            .setDescription(info[interaction.values[0]])
            .setColor(0x00AE86);
        
        return await interaction.update({ embeds: [embed] }).catch(console.error);
    }

    // --- ボタン処理 ---
    if (interaction.isButton()) {
        const cid = interaction.customId;

        // メッセージ削除実行
        if (cid.startsWith('bulk_delete_confirm_')) {
            const amount = parseInt(cid.split('_')[3]);
            await interaction.deferUpdate(); // ボタン自体を更新
            await interaction.channel.bulkDelete(amount, true)
                .then(m => interaction.followUp({ content: `✅ ${m.size}件削除しました。`, flags: MessageFlags.Ephemeral }))
                .catch(() => interaction.followUp({ content: "❌ エラー：14日以上前のメッセージは一括削除できません。", flags: MessageFlags.Ephemeral }));
            return;
        }

        // メッセージ削除キャンセル
        if (cid === 'bulk_delete_cancel') {
            return await interaction.update({ content: '削除をキャンセルしました。', embeds: [], components: [] });
        }

        // ロール付与認証ボタン
        if (cid.startsWith('v_role_')) {
            const roleId = cid.split('_')[2];
            try {
                await interaction.member.roles.add(roleId);
                return await interaction.reply({ content: '✅ ロールを付与しました！', flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: '❌ 権限エラー：Botのロール順位が不足しています。', flags: MessageFlags.Ephemeral });
            }
        }

        // チケット作成実行ボタン
        if (cid.startsWith('tkt_')) {
            const [_, adminId, key] = cid.split('_');
            const panelMsg = ticketMessages.get(key) ?? '担当者が来るまでお待ちください。';
            
            try {
                const channel = await interaction.guild.channels.create({
                    name: `🎫｜${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });
                
                const closeBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('t_close_req').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger)
                );
                
                await channel.send({ content: `${interaction.user} 様\n${panelMsg}\n\n<@&${adminId}>`, components: [closeBtn] });
                return await interaction.reply({ content: `チケットを作成しました: ${channel}`, flags: MessageFlags.Ephemeral });
            } catch (e) {
                return await interaction.reply({ content: "❌ チャンネル作成に失敗しました。権限を確認してください。", flags: MessageFlags.Ephemeral });
            }
        }

        // チケットを閉じる（確認）
        if (cid === 't_close_req') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('t_close_yes').setLabel('削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('t_close_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            return await interaction.reply({ content: 'このチャンネルを削除しますか？', components: [row], flags: MessageFlags.Ephemeral });
        }

        // チケット削除実行
        if (cid === 't_close_yes') {
            await interaction.channel.delete().catch(() => {});
        }

        // チケット削除キャンセル
        if (cid === 't_close_no') {
            return await interaction.update({ content: '削除をキャンセルしました。', components: [] });
        }
    }
});

// Botログイン
client.login(process.env.DISCORD_TOKEN);
