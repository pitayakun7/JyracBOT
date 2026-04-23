const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    ActivityType 
} = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// チケットパネルごとのメッセージ内容を保持（カスタムIDの文字数制限対策）
const ticketMessages = new Map();

// 【設定】自己紹介ステータスのループ文章
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお知らせはDiscordID’pitayakun7’まで"
];
const intervalSeconds = 15;

// --- 2. スラッシュコマンドの定義（グローバル登録用） ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細パネルを表示します')
].map(c => c.toJSON());

// --- 3. 起動時処理 & コマンド登録 ---
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        // グローバルコマンドとして全サーバーに登録
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`${client.user.tag} 起動完了！コマンドをグローバル展開しました。`);
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }

    // ステータスのローテーション開始
    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

// Renderなどのホスティング維持用Webサーバー
const app = express();
app.get('/', (req, res) => res.send('Bot is Active!'));
app.listen(3000);

// --- 4. インタラクション処理（メインロジック） ---
client.on('interactionCreate', async interaction => {
    if (interaction.replied || interaction.deferred) return;

    // A. ロール順位による実行制限チェック
    // スラッシュコマンド実行時、および削除実行ボタン押下時にチェック
    if (interaction.isChatInputCommand() || (interaction.isButton() && interaction.customId.startsWith('bulk_delete_yes'))) {
        const botMember = interaction.guild.members.me;
        const executor = interaction.member;
        
        // サーバーオーナーでない、かつBotの最高ロール順位以下の場合に拒否
        if (executor.id !== interaction.guild.ownerId && executor.roles.highest.position <= botMember.roles.highest.position) {
            const noPermMsg = "お持ちのロールに使用権限がありません";
            return await interaction.reply({ content: noPermMsg, ephemeral: true });
        }
    }

    // B. スラッシュコマンド応答
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // /help コマンド
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 総合コマンドヘルプ')
                .setDescription('詳細を確認したいコマンドを下のメニューから選んでください。')
                .setColor(0x00AE86);
            const select = new StringSelectMenuBuilder().setCustomId('help_select').setPlaceholder('コマンドを選択...')
                .addOptions(
                    { label: '/verify', description: '認証・ロール付与パネル', value: 'help_verify' },
                    { label: '/ticket', description: 'お問い合わせチケット作成', value: 'help_ticket' },
                    { label: '/role-confirmation', description: 'ユーザーのロール一覧表示', value: 'help_role' },
                    { label: '/delete', description: 'メッセージの一括削除（確認付）', value: 'help_delete' }
                );
            await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }

        // /delete コマンド
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100の間で指定してください。', ephemeral: true });

            // 直近のメッセージ（本人のコマンド呼び出し以外）を1件取得
            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            let msgDetails = "確認できるメッセージが見つかりません。";
            if (lastMsg) {
                const link = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${lastMsg.id}`;
                msgDetails = `**発言者:** ${lastMsg.author.tag}\n**内容:** ${lastMsg.content.substring(0, 50) || "（画像または埋め込み等）"}\n**リンク:** [ここをクリックしてメッセージを確認](${link})`;
            }

            const embed = new EmbedBuilder()
                .setTitle('⚠️ メッセージ削除の最終確認')
                .setDescription(`本当にこのチャンネルのメッセージを **${amount}件** 削除しますか？\n\n**削除対象の先頭メッセージ:**\n${msgDetails}`)
                .setColor(0xFF0000)
                .setFooter({ text: "※削除が完了すると上記のリンクは無効になります" });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除を実行する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // /verify コマンド
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'サーバー認証')
                .setDescription(options.getString('description') ?? '下のボタンを押すと認証が完了し、指定のロールが付与されます。')
                .setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅ 認証してロールを受け取る').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /ticket コマンド
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケットを発行しました。担当者が来るまでそのままお待ちください。');

            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'お問い合わせ窓口')
                .setDescription(options.getString('description') ?? '質問や相談がある場合は、下のボタンを押して専用チャンネルを作成してください。')
                .setColor(0x9B59B6);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('🎫 チケットを発行する').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /role-confirmation コマンド
        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: 'メンバー情報を取得できませんでした。', ephemeral: true });
            
            const roles = member.roles.cache
                .filter(r => r.name !== '@everyone')
                .sort((a, b) => b.position - a.position)
                .map(r => r.name)
                .join('\n') || 'なし';
                
            await interaction.reply({ content: `**${member.user.tag}** の現在のロール一覧:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // C. ヘルプ詳細表示（プルダウン応答）
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'help_select') {
            const selected = interaction.values[0];
            const h = {
                help_verify: "# /verify\n指定したロールを自動付与するパネルを設置します。サーバーへの新規参加者の認証フローに最適です。",
                help_ticket: "# /ticket\nボタンを押すと運営との個別チャンネルを作成します。管理者ロールに通知を送る設定も可能です。",
                help_role: "# /role-confirmation\n特定のユーザーが現在持っているすべてのロールを、順位が高い順に一覧表示します。",
                help_delete: "# /delete\n大量のメッセージを即座に削除します。誤削除防止のため、最新メッセージの内容とリンクが表示されます。"
            };
            await interaction.update({ content: h[selected], embeds: [], components: [interaction.message.components[0]] });
        }
    }

    // D. ボタン操作への応答
    if (interaction.isButton()) {
        // メッセージ一括削除の実行
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true)
                .then(m => interaction.update({ content: `✅ ${m.size}件のメッセージを削除しました。`, embeds: [], components: [] }))
                .catch(err => interaction.update({ content: "❌ 失敗: 14日以上前のメッセージはDiscordの制限により一括削除できません。", embeds: [], components: [] }));
        }
        if (interaction.customId === 'bulk_delete_no') {
            await interaction.update({ content: '削除をキャンセルしました。', embeds: [], components: [] });
        }

        // 認証ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(console.error);
            await interaction.reply({ content: 'ロールを正常に付与しました！', ephemeral: true });
        }

        // チケット作成処理
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminId, key] = interaction.customId.split('_');
            const desc = ticketMessages.get(key) ?? '担当者が対応します。';
            
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tkt_del_confirm').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger)
            );
            await channel.send({ content: `${interaction.user} 様、お問い合わせありがとうございます。\n${desc}\n\n通知: <@&${adminId}>`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        // チケット削除の二段階確認
        if (interaction.customId === 'tkt_del_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tkt_del_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('tkt_del_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: 'このチケットを削除（クローズ）してもよろしいですか？', components: [row], ephemeral: true });
        }
        if (interaction.customId === 'tkt_del_yes') {
            await interaction.channel.delete();
        }
        if (interaction.customId === 'tkt_del_no') {
            await interaction.update({ content: '削除をキャンセルしました。', components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
