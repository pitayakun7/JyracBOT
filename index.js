const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, ActivityType 
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

// チケットメッセージの一時保存用
const ticketMessages = new Map();

// 【設定】ステータスの自己紹介ループ内容
const activities = [
    "JYRAC公式Instaはこちら！▶https://www.instagram.com/jyrac_official/",
    "NSF公式Instaはこちら！▶https://www.instagram.com/2024nsfproject/",
    "ボットに関するお知らせはDiscordID’pitayakun7’まで",
];
const intervalSeconds = 15; // 切り替え間隔（秒）

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネルを作成します')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false)),
    
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネルを作成します')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false)),
    
    new SlashCommandBuilder().setName('role-confirmation').setDescription('メンバーの付与ロールを確認します')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true)),
    
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します（二段階確認）')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true)),
    
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細を確認できるパネルを表示します')
].map(c => c.toJSON());

// --- 3. 起動時処理 & ステータス更新 ---
client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('コマンド登録完了！');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }

    // 自己紹介ステータスのローテーション
    let i = 0;
    setInterval(() => {
        client.user.setActivity(activities[i], { type: ActivityType.Custom });
        i = (i + 1) % activities.length;
    }, intervalSeconds * 1000);
});

// Render維持用Webサーバー
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

// --- 4. メインインタラクション処理 ---
client.on('interactionCreate', async interaction => {
    // すでに返信済みか確認
    if (interaction.replied || interaction.deferred) return;

    // --- スラッシュコマンド ---
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // /help コマンド
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📜 コマンドヘルプパネル')
                .setDescription('詳細を確認したいコマンドを下のプルダウンから選んでください。')
                .setColor(0x00AE86);

            const select = new StringSelectMenuBuilder()
                .setCustomId('help_select')
                .setPlaceholder('コマンドを選択してください')
                .addOptions(
                    { label: '/verify', description: '認証パネルの作成', value: 'help_verify' },
                    { label: '/ticket', description: 'チケットパネルの作成', value: 'help_ticket' },
                    { label: '/role-confirmation', description: 'ロールの確認', value: 'help_role' },
                    { label: '/delete', description: 'メッセージの削除', value: 'help_delete' }
                );

            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // /delete コマンド (二段階確認)
        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100の間で指定してください。', ephemeral: true });

            // 最新のメッセージをフェッチ
            const messages = await interaction.channel.messages.fetch({ limit: 1 });
            const lastMsg = messages.first();
            const lastMsgContent = lastMsg ? (lastMsg.content.substring(0, 50) || "（画像または埋め込み等）") : "なし";
            const lastMsgAuthor = lastMsg ? lastMsg.author.tag : "不明";

            const embed = new EmbedBuilder()
                .setTitle('⚠️ メッセージ削除の確認')
                .setDescription(`本当に **${amount}件** のメッセージを削除しますか？\n\n**削除対象の先頭メッセージ:**\n\`${lastMsgAuthor}: ${lastMsgContent}\``)
                .setColor(0xFF0000);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bulk_delete_yes_${amount}`).setLabel('削除を実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('bulk_delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // /verify コマンド
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'ロール付与')
                .setDescription(options.getString('description') ?? 'ボタンを押してロールを取得してください。');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /ticket コマンド
        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, options.getString('panel-desc') ?? 'チケット発行ありがとうございます。担当者が来るまでしばらくお待ちください。');

            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? '問い合わせパネル')
                .setDescription(options.getString('description') ?? 'ボタンを押してチケットを作成してください。');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // /role-confirmation コマンド
        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: 'メンバー情報が取得できませんでした。', ephemeral: true });
            
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }
    }

    // --- プルダウンメニュー (Help用) ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'help_select') {
            const selected = interaction.values[0];
            const helpTexts = {
                help_verify: "# /verify\n指定したロールを自動付与するパネルを作成します。",
                help_ticket: "# /ticket\n管理者を呼び出すチケット作成パネルを作成します。",
                help_role: "# /role-confirmation\nメンバーが所有しているロールを一覧表示します。",
                help_delete: "# /delete\nチャンネル内のメッセージを数件指定して削除します。実行前に確認が出ます。"
            };
            await interaction.update({ content: helpTexts[selected], embeds: [], components: [interaction.message.components[0]] });
        }
    }

    // --- ボタン処理 ---
    if (interaction.isButton()) {
        // ロール付与
        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(console.error);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        // チケット発行
        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminRoleId, messageKey] = interaction.customId.split('_');
            const panelDesc = ticketMessages.get(messageKey) ?? 'お待ちください。';
            
            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケットを閉じる').setStyle(ButtonStyle.Danger)
            );
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n<@&${adminRoleId}>`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        // チケット削除確認
        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('削除を実行').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }
        if (interaction.customId === 'delete_yes') await interaction.channel.delete().catch(console.error);
        if (interaction.customId === 'delete_no') await interaction.update({ content: '削除をキャンセルしました。', components: [] });

        // /delete の二段階実行
        if (interaction.customId.startsWith('bulk_delete_yes_')) {
            const amount = parseInt(interaction.customId.split('_')[3]);
            await interaction.channel.bulkDelete(amount, true).catch(console.error);
            await interaction.update({ content: `✅ ${amount}件のメッセージを削除しました。`, embeds: [], components: [] });
        }
        if (interaction.customId === 'bulk_delete_no') {
            await interaction.update({ content: '削除をキャンセルしました。', embeds: [], components: [] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
